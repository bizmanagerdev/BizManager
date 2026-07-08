import * as Sentry from "@sentry/nextjs";
import { toHebrewError } from "@/lib/error-messages";
import { after, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { buildPaymentInsert } from "@/lib/payments";
import {
  derivePaymentStatus,
  hasInvalidPaymentEntry,
  normalizePaymentEntries,
  sumPayments,
} from "@/lib/orders/paymentStatus";
import {
  tryAutoIssueInvoiceForOrder,
  tryAutoIssueReceiptForPayment,
} from "@/lib/morning/service";
import { computeDueDate, normalizePaymentTerms } from "@/lib/paymentTerms";
import { STORAGE_BUCKET } from "@/lib/storage";

const BUCKET = STORAGE_BUCKET;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type OrderItemPayload = {
  product_id?: string;
  quantity_ordered?: number | string;
  unit_price?: number | string;
  discount_amount?: number | string;
  notes?: string | null;
};

type UpdateOrderPayload = {
  order_id?: string;
  customer_id?: string;
  order_date?: string;
  status?: string;
  payment_status?: string;
  payment_terms?: string | null;
  due_date?: string | null;
  delivery_date?: string | null;
  discount_amount?: number | string;
  collect_payment_on_delivery?: boolean | null;
  notes?: string | null;
  payments?: {
    amount_total?: number | string;
    payment_date?: string | null;
    payment_method?: string | null;
    account_id?: string | null;
    due_date?: string | null;
    reference_number?: string | null;
    check_number?: string | null;
    notes?: string | null;
  }[];
  refunds?: {
    amount_total?: number | string;
    payment_date?: string | null;
    payment_method?: string | null;
    account_id?: string | null;
    due_date?: string | null;
    reference_number?: string | null;
    check_number?: string | null;
    notes?: string | null;
  }[];
  // Note-only edits to already-saved payments (the wizard's existing-payments editor).
  existing_payment_notes?: { id?: string; notes?: string | null }[];
  items?: OrderItemPayload[];
};

type UploadedDocument = {
  documentId: string;
  storagePath: string;
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function toNonNegativeInt(value: unknown) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.max(0, Math.round(parsed));
}

function toPositiveInt(value: unknown) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.max(1, Math.round(parsed));
}

function safeExtensionFromFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return "";
  const ext = (parts.pop() ?? "").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 10);
}

async function cleanupUploadedDocument(supabase: SupabaseClient, uploaded: UploadedDocument[]) {
  if (uploaded.length === 0) return;

  for (const document of uploaded) {
    await supabase.from("document_links").delete().eq("document_id", document.documentId);
    await supabase.from("documents").delete().eq("id", document.documentId);
    await supabase.storage.from(BUCKET).remove([document.storagePath]);
  }
}

function hasInvalidRefundEntry(entries: ReturnType<typeof normalizePaymentEntries>) {
  return entries.some(
    (entry) =>
      !Number.isFinite(entry.amount_total) ||
      entry.amount_total <= 0 ||
      !entry.payment_date ||
      !entry.payment_method
  );
}

export async function POST(req: Request) {
  try {
    // Auth first so a queued offline confirm can be deduped by Idempotency-Key
    // before any work runs. orders/update is multi-step and NOT atomic (image
    // upload → RPC → payments → refunds), so a blind replay could double-insert
    // payments or double-consume stock — withIdempotency makes a replay a no-op
    // that returns the original cached response. Only the multipart "אישור
    // אספקה" flow sends a key; the JSON edit path has none → runs unwrapped.
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return withIdempotency(req, supabase, user.id, "orders/update", async () => {
    const contentType = req.headers.get("content-type") ?? "";
    let body: UpdateOrderPayload;
    let deliveryImages: File[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const payload = form.get("payload");
      const rawFiles = form.getAll("delivery_images");

      if (typeof payload !== "string") {
        return NextResponse.json({ error: "Missing payload" }, { status: 400 });
      }

      body = JSON.parse(payload) as UpdateOrderPayload;
      deliveryImages = rawFiles.filter((file): file is File => file instanceof File && file.size > 0);
    } else {
      body = (await req.json()) as UpdateOrderPayload;
    }

    const orderId = typeof body.order_id === "string" ? body.order_id : "";
    const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
    const orderDate = typeof body.order_date === "string" ? body.order_date : "";
    const status = typeof body.status === "string" ? body.status : "draft";
    const discountAmount = toNonNegativeInt(body.discount_amount ?? 0);
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const payments = normalizePaymentEntries(body.payments);
    const refunds = normalizePaymentEntries(body.refunds);

    const items = Array.isArray(body.items) ? body.items : [];
    if (!orderId || !customerId || !orderDate || items.length === 0) {
      return NextResponse.json({ error: "Missing required order fields" }, { status: 400 });
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      return NextResponse.json({ error: "Invalid discount amount" }, { status: 400 });
    }
    if (hasInvalidPaymentEntry(payments)) {
      return NextResponse.json({ error: "Invalid payment payload" }, { status: 400 });
    }
    if (hasInvalidRefundEntry(refunds)) {
      return NextResponse.json({ error: "Invalid refund payload" }, { status: 400 });
    }
    const invalidDeliveryImage = deliveryImages.find((file) => !file.type.startsWith("image/"));
    if (invalidDeliveryImage) {
      return NextResponse.json({ error: "Delivery attachment must be an image" }, { status: 400 });
    }
    const oversizedDeliveryImage = deliveryImages.find((file) => file.size > MAX_IMAGE_BYTES);
    if (oversizedDeliveryImage) {
      return NextResponse.json({ error: `Image too large (max ${MAX_IMAGE_BYTES} bytes)` }, { status: 413 });
    }

    const normalizedItems = items.map((item) => ({
      product_id: typeof item.product_id === "string" ? item.product_id : "",
      quantity_ordered: toPositiveInt(item.quantity_ordered),
      unit_price: toNonNegativeInt(item.unit_price),
      discount_amount: toNonNegativeInt(item.discount_amount ?? 0),
      notes: typeof item.notes === "string" ? item.notes.trim() : null,
    }));

    const invalidItem = normalizedItems.find(
      (item) =>
        !item.product_id ||
        !Number.isFinite(item.quantity_ordered) ||
        item.quantity_ordered <= 0 ||
        !Number.isFinite(item.unit_price) ||
        item.unit_price < 0 ||
        !Number.isFinite(item.discount_amount) ||
        item.discount_amount < 0
    );
    if (invalidItem) {
      return NextResponse.json({ error: "Invalid order item payload" }, { status: 400 });
    }

    const uploadedDocuments: UploadedDocument[] = [];

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + item.quantity_ordered * item.unit_price - item.discount_amount,
      0
    );
    const totalAmount = subtotal - discountAmount;

    const [
      { data: existingPayments, error: existingPaymentsError },
      { data: customer, error: customerError },
    ] = await Promise.all([
      supabase.from("payments").select("amount_total").eq("order_id", orderId),
      supabase.from("customers").select("requires_prepayment").eq("id", customerId).maybeSingle(),
    ]);

    if (existingPaymentsError) {
      return NextResponse.json({ error: toHebrewError(existingPaymentsError.message) }, { status: 400 });
    }
    if (customerError) {
      return NextResponse.json({ error: toHebrewError(customerError.message) }, { status: 400 });
    }

    const totalPaidAfterSave =
      sumPayments(existingPayments ?? []) + sumPayments(payments) - sumPayments(refunds);
    if (customer?.requires_prepayment === true && totalPaidAfterSave + 0.009 < totalAmount) {
      return NextResponse.json(
        { error: "Customer requires prepayment. Collect full payment before saving the order." },
        { status: 400 }
      );
    }

    const paymentStatus = derivePaymentStatus(totalAmount, totalPaidAfterSave);

    if (deliveryImages.length > 0) {
      const prepared = deliveryImages.map((deliveryImage) => {
        const documentId = crypto.randomUUID();
        const displayName =
          (deliveryImage.name.split(/[/\\]/).pop() ?? "delivery-image").trim() || "delivery-image";
        const ext = safeExtensionFromFilename(displayName);
        const storagePath = ext ? `orders/${orderId}/${documentId}.${ext}` : `orders/${orderId}/${documentId}`;
        return { file: deliveryImage, documentId, displayName, storagePath };
      });
      const allPaths = prepared.map((entry) => entry.storagePath);

      const uploadResults = await Promise.all(
        prepared.map((entry) =>
          supabase.storage.from(BUCKET).upload(entry.storagePath, entry.file, {
            contentType: entry.file.type || undefined,
            upsert: false,
          })
        )
      );

      const failedUpload = uploadResults.find((result) => result.error);
      if (failedUpload?.error) {
        const succeededPaths = allPaths.filter((_, index) => !uploadResults[index].error);
        if (succeededPaths.length > 0) {
          await supabase.storage.from(BUCKET).remove(succeededPaths);
        }
        return NextResponse.json({ error: toHebrewError(failedUpload.error.message) }, { status: 400 });
      }

      const uploadedAt = new Date().toISOString();
      const { error: docError } = await supabase.from("documents").insert(
        prepared.map((entry) => ({
          id: entry.documentId,
          document_type: "order_delivery_image",
          business_domain: "sales", // order documents always belong to the מכירות domain
          title: entry.displayName,
          file_name: entry.displayName,
          storage_key: entry.storagePath,
          uploaded_by: user.id,
          uploaded_at: uploadedAt,
          notes: null,
        }))
      );

      if (docError) {
        await supabase.storage.from(BUCKET).remove(allPaths);
        return NextResponse.json({ error: toHebrewError(docError.message) }, { status: 400 });
      }

      const { error: linkError } = await supabase.from("document_links").insert(
        prepared.map((entry) => ({
          document_id: entry.documentId,
          entity_type: "order",
          entity_id: orderId,
        }))
      );

      if (linkError) {
        await supabase
          .from("documents")
          .delete()
          .in("id", prepared.map((entry) => entry.documentId));
        await supabase.storage.from(BUCKET).remove(allPaths);
        return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
      }

      uploadedDocuments.push(
        ...prepared.map((entry) => ({ documentId: entry.documentId, storagePath: entry.storagePath }))
      );
    }

    // Payment terms + due date + delivery date go INTO the RPC's single orders
    // UPDATE (no follow-up UPDATE that would log an extra "עודכן" audit row).
    const paymentTerms = normalizePaymentTerms(body.payment_terms);
    const dueDate =
      typeof body.due_date === "string" && body.due_date.trim()
        ? body.due_date.trim()
        : computeDueDate(orderDate, paymentTerms);
    // The delivery-confirmation date is only sent by the "אישור אספקה" flow.
    const deliveryDate =
      typeof body.delivery_date === "string" && body.delivery_date.trim()
        ? body.delivery_date.trim()
        : null;

    const { data, error } = await supabase.rpc("update_sales_order", {
      p_order_id: orderId,
      p_customer_id: customerId,
      p_order_date: orderDate,
      p_status: status,
      p_subtotal: subtotal,
      p_discount_amount: discountAmount,
      p_total_amount: totalAmount,
      p_payment_status: paymentStatus,
      p_updated_by: user.id,
      p_notes: notes,
      p_items: normalizedItems,
      p_payment_terms: paymentTerms,
      p_due_date: dueDate,
      p_delivery_date: deliveryDate,
    });

    if (error) {
      await cleanupUploadedDocument(supabase, uploadedDocuments);
      // This failure is returned as a 400, so it never reaches Sentry on its own — log
      // it explicitly with the real DB message and context so order-confirm failures are
      // diagnosable instead of surfacing only as the generic "אישור ההזמנה נכשל".
      console.error("update_sales_order RPC failed", { orderId, message: error.message });
      Sentry.captureException(new Error(`update_sales_order failed: ${error.message}`), {
        tags: { route: "orders/update", op: "update_sales_order" },
        extra: { orderId, customerId, itemCount: normalizedItems.length, totalAmount },
      });

      // Insufficient stock: confirming supply consumes stock (`out` movement), and the
      // inventory trigger blocks on-hand from going negative. Explain it in Hebrew, naming
      // the product and the shortfall, instead of the generic "אישור ההזמנה נכשל".
      const stockMatch = error.message.match(
        /Inventory cannot be negative for product ([0-9a-f-]{36})/i
      );
      if (stockMatch) {
        const shortProductId = stockMatch[1];
        const requested = normalizedItems
          .filter((item) => item.product_id === shortProductId)
          .reduce((sum, item) => sum + item.quantity_ordered, 0);
        const [{ data: product }, { data: stock }] = await Promise.all([
          supabase.from("products").select("name").eq("id", shortProductId).maybeSingle(),
          supabase
            .from("inventory")
            .select("quantity_on_hand")
            .eq("product_id", shortProductId)
            .maybeSingle(),
        ]);
        const name = (product as { name?: string } | null)?.name?.trim() || "הפריט";
        const onHand = Math.max(
          0,
          Number((stock as { quantity_on_hand?: number } | null)?.quantity_on_hand ?? 0)
        );
        return NextResponse.json(
          {
            error: `אין מספיק מלאי לאישור אספקה של "${name}" — במלאי ${onHand}, נדרש ${requested}. צמצמו את הכמות או עדכנו את המלאי ונסו שוב.`,
          },
          { status: 400 }
        );
      }

      const hint =
        error.message.includes("update_sales_order") || error.message.includes("function")
          ? "Missing DB function update_sales_order. Run db/sql/update_sales_order_rpc.sql"
          : error.message;
      return NextResponse.json({ error: hint }, { status: 400 });
    }

    const insertedPaymentIds: string[] = [];
    if (payments.length > 0) {
      const { data: insertedPaymentRows, error: paymentsInsertError } = await supabase
        .from("payments")
        .insert(
          payments.map((payment) => ({
            ...buildPaymentInsert({
              amountTotal: payment.amount_total,
              businessDomain: "sales",
              orderId,
              paymentDate: payment.payment_date!,
              paymentMethod: payment.payment_method!,
              dueDate: payment.due_date,
              referenceNumber: payment.reference_number,
              checkNumber: payment.payment_method === "check" ? payment.check_number : null,
              notes: payment.notes,
              recordedBy: user.id,
              accountId: payment.account_id,
            }),
          }))
        )
        .select("id");

      if (paymentsInsertError) {
        await cleanupUploadedDocument(supabase, uploadedDocuments);
        return NextResponse.json({ error: toHebrewError(paymentsInsertError.message) }, { status: 400 });
      }
      for (const row of insertedPaymentRows ?? []) {
        if (row && typeof (row as { id?: unknown }).id === "string") {
          insertedPaymentIds.push((row as { id: string }).id);
        }
      }
    }

    if (refunds.length > 0) {
      const { error: refundsInsertError } = await supabase.from("payments").insert(
        refunds.map((refund) => ({
          ...buildPaymentInsert({
            amountTotal: refund.amount_total * -1,
            businessDomain: "sales",
            orderId,
            paymentDate: refund.payment_date!,
            paymentMethod: refund.payment_method!,
            dueDate: refund.due_date,
            referenceNumber: refund.reference_number,
            checkNumber: refund.payment_method === "check" ? refund.check_number : null,
            notes: refund.notes ? `Refund: ${refund.notes}` : "Refund",
            recordedBy: user.id,
            accountId: refund.account_id,
          }),
        }))
      );

      if (refundsInsertError) {
        await cleanupUploadedDocument(supabase, uploadedDocuments);
        const message =
          refundsInsertError.message.includes("payments_amount_total_check") ||
          refundsInsertError.message.includes("payments_net_amount_check") ||
          refundsInsertError.message.includes("payments_amount_before_vat_check")
          ? "הטבלה payments עדיין לא מאפשרת החזרים. יש להריץ db/sql/allow_order_refunds_in_payments.sql"
          : refundsInsertError.message;
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    // payment_status / payment_terms / due_date / delivery_confirmed_at are now
    // written inside update_sales_order's single UPDATE above.
    const derivedPaymentStatus = paymentStatus;

    // Best-effort: the column only exists after db/sql/add_collect_payment_on_delivery.sql.
    if (typeof body.collect_payment_on_delivery === "boolean") {
      await supabase
        .from("orders")
        .update({ collect_payment_on_delivery: body.collect_payment_on_delivery })
        .eq("id", orderId);
    }

    // Note-only edits to existing payments. Scoped to this order so a payment can
    // never be edited out of context. Only the rows the client flagged as changed.
    const existingPaymentNotes = Array.isArray(body.existing_payment_notes)
      ? body.existing_payment_notes
      : [];
    for (const entry of existingPaymentNotes) {
      const paymentId = typeof entry?.id === "string" ? entry.id.trim() : "";
      if (!paymentId) continue;
      const noteValue = typeof entry?.notes === "string" ? entry.notes.trim() : "";
      const { error: noteError } = await supabase
        .from("payments")
        .update({ notes: noteValue || null })
        .eq("id", paymentId)
        .eq("order_id", orderId);
      if (noteError) {
        return NextResponse.json({ error: toHebrewError(noteError.message) }, { status: 400 });
      }
    }

    const updatedOrderId = typeof data === "string" ? data : orderId;

    // Best-effort Morning auto-issue: invoice when order is completed, receipt for each
    // new payment row. Failures are logged via audit and never abort the order save.
    // Runs after the response is sent so the external Morning API never delays the save.
    const actor = { profileId: profile.id, authUserId: user.id, role: profile.role };
    after(async () => {
      try {
        await tryAutoIssueInvoiceForOrder(supabase, {
          orderId: updatedOrderId,
          newStatus: status,
          trigger: "status-change",
          actor,
        });
        for (const paymentId of insertedPaymentIds) {
          await tryAutoIssueReceiptForPayment(supabase, { paymentId, actor });
        }
      } catch (morningError) {
        console.error("Morning auto-issue failed after order update", morningError);
      }
    });

    return NextResponse.json({
      order_id: updatedOrderId,
      payment_status: derivedPaymentStatus,
      total_paid: totalPaidAfterSave,
      payment_ids: insertedPaymentIds,
    });
    });
  } catch (err: unknown) {
    console.error("orders/update unhandled error", err);
    Sentry.captureException(err, { tags: { route: "orders/update" } });
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
