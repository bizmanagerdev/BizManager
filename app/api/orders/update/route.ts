import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  derivePaymentStatus,
  hasInvalidPaymentEntry,
  normalizePaymentEntries,
  sumPayments,
} from "@/lib/orders/paymentStatus";

const BUCKET = "business-documents";
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
  discount_amount?: number | string;
  notes?: string | null;
  payments?: {
    amount_total?: number | string;
    payment_date?: string | null;
    payment_method?: string | null;
    reference_number?: string | null;
    notes?: string | null;
  }[];
  refunds?: {
    amount_total?: number | string;
    payment_date?: string | null;
    payment_method?: string | null;
    reference_number?: string | null;
    notes?: string | null;
  }[];
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

async function cleanupUploadedDocument(supabase: any, uploaded: UploadedDocument[]) {
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

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;
    let uploadedDocuments: UploadedDocument[] = [];

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + item.quantity_ordered * item.unit_price - item.discount_amount,
      0
    );
    const totalAmount = subtotal - discountAmount;

    const { data: existingPayments, error: existingPaymentsError } = await supabase
      .from("payments")
      .select("amount_total")
      .eq("target_type", "order")
      .eq("target_id", orderId);

    if (existingPaymentsError) {
      return NextResponse.json({ error: existingPaymentsError.message }, { status: 400 });
    }

    const totalPaidAfterSave =
      sumPayments(existingPayments ?? []) + sumPayments(payments) - sumPayments(refunds);
    const paymentStatus = derivePaymentStatus(totalAmount, totalPaidAfterSave);

    if (deliveryImages.length > 0) {
      for (const deliveryImage of deliveryImages) {
        const documentId = crypto.randomUUID();
        const displayName = (deliveryImage.name.split(/[/\\]/).pop() ?? "delivery-image").trim() || "delivery-image";
        const ext = safeExtensionFromFilename(displayName);
        const storagePath = ext ? `orders/${orderId}/${documentId}.${ext}` : `orders/${orderId}/${documentId}`;
        const uploadedAt = new Date().toISOString();

        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, deliveryImage, {
          contentType: deliveryImage.type || undefined,
          upsert: false,
        });
        if (uploadError) {
          await cleanupUploadedDocument(supabase, uploadedDocuments);
          return NextResponse.json({ error: uploadError.message }, { status: 400 });
        }

        const { error: docError } = await supabase.from("documents").insert({
          id: documentId,
          document_type: "order_delivery_image",
          title: displayName,
          file_name: displayName,
          storage_key: storagePath,
          uploaded_by: user.id,
          uploaded_at: uploadedAt,
          notes: null,
        });

        if (docError) {
          await supabase.storage.from(BUCKET).remove([storagePath]);
          await cleanupUploadedDocument(supabase, uploadedDocuments);
          return NextResponse.json({ error: docError.message }, { status: 400 });
        }

        const { error: linkError } = await supabase.from("document_links").insert({
          document_id: documentId,
          entity_type: "order",
          entity_id: orderId,
        });

        if (linkError) {
          await supabase.from("documents").delete().eq("id", documentId);
          await supabase.storage.from(BUCKET).remove([storagePath]);
          await cleanupUploadedDocument(supabase, uploadedDocuments);
          return NextResponse.json({ error: linkError.message }, { status: 400 });
        }

        uploadedDocuments.push({ documentId, storagePath });
      }
    }

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
    });

    if (error) {
      await cleanupUploadedDocument(supabase, uploadedDocuments);
      const hint =
        error.message.includes("update_sales_order") || error.message.includes("function")
          ? "Missing DB function update_sales_order. Run db/sql/update_sales_order_rpc.sql"
          : error.message;
      return NextResponse.json({ error: hint }, { status: 400 });
    }

    if (payments.length > 0) {
      const { error: paymentsInsertError } = await supabase.from("payments").insert(
        payments.map((payment) => ({
          target_type: "order",
          target_id: orderId,
          payment_date: payment.payment_date,
          amount_total: payment.amount_total,
          payment_method: payment.payment_method,
          reference_number: payment.reference_number,
          vat_amount: 0,
          amount_before_vat: payment.amount_total,
          net_amount: payment.amount_total,
          notes: payment.notes,
          recorded_by: user.id,
        }))
      );

      if (paymentsInsertError) {
        await cleanupUploadedDocument(supabase, uploadedDocuments);
        return NextResponse.json({ error: paymentsInsertError.message }, { status: 400 });
      }
    }

    if (refunds.length > 0) {
      const { error: refundsInsertError } = await supabase.from("payments").insert(
        refunds.map((refund) => ({
          target_type: "order",
          target_id: orderId,
          payment_date: refund.payment_date,
          amount_total: refund.amount_total * -1,
          payment_method: refund.payment_method,
          reference_number: refund.reference_number,
          vat_amount: 0,
          amount_before_vat: refund.amount_total * -1,
          net_amount: refund.amount_total * -1,
          notes: refund.notes ? `Refund: ${refund.notes}` : "Refund",
          recorded_by: user.id,
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

    const derivedPaymentStatus = derivePaymentStatus(totalAmount, totalPaidAfterSave);
    const { error: updateError } = await supabase
      .from("orders")
      .update({ payment_status: derivedPaymentStatus })
      .eq("id", orderId);

    if (updateError) {
      await cleanupUploadedDocument(supabase, uploadedDocuments);
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    const updatedOrderId = typeof data === "string" ? data : orderId;
    return NextResponse.json({
      order_id: updatedOrderId,
      payment_status: derivedPaymentStatus,
      total_paid: totalPaidAfterSave,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
