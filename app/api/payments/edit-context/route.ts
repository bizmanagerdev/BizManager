import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { PAYMENT_SELECT } from "@/lib/payments";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { splitPaymentAmounts } from "@/lib/orders/paymentStatus";

// Read-only context for editing a `payments` row inline from the account
// register (app/(app)/financial/bank/BankClient.tsx) — the register only
// keeps display fields on its ledger rows, not the whole record. Branches by
// which parent the payment is tied to, since each one is edited through a
// different existing dialog + a different update endpoint's ownership rule:
//   - order_id   → OrderPaymentActionsClient's EditPaymentDialog, needs the
//                  order's total_amount + every sibling payment's amount to
//                  preview the next payment_status (mirrors
//                  /api/orders/payments/update's own recompute).
//   - project_id → ProjectExpenseDialogs' AddIncomeDialog, needs the
//                  project's frozen VAT rate/type/start date.
//   - neither    → a standalone income row; AddIncomeDialog is reused for
//                  this too (projectId "" round-trips through
//                  /api/payments/update the same as a real standalone edit).
// The actual mutation still goes through those routes' own role gates
// (admin/office for order-tied, unrestricted for the other two) — this
// endpoint only reads.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const paymentId = (url.searchParams.get("id") ?? "").trim();
    if (!paymentId) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select(PAYMENT_SELECT)
      .eq("id", paymentId)
      .maybeSingle();
    if (paymentError) {
      return NextResponse.json({ error: toHebrewError(paymentError.message) }, { status: 400 });
    }
    if (!payment?.id) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.order_id) {
      const [{ data: order, error: orderError }, { data: siblingPayments, error: siblingError }] =
        await Promise.all([
          supabase.from("orders").select("total_amount").eq("id", payment.order_id).maybeSingle(),
          supabase
            .from("payments")
            .select("amount_total,payment_status,due_date")
            .eq("order_id", payment.order_id),
        ]);
      if (orderError) return NextResponse.json({ error: toHebrewError(orderError.message) }, { status: 400 });
      if (siblingError) return NextResponse.json({ error: toHebrewError(siblingError.message) }, { status: 400 });

      const { collected: totalPaid } = splitPaymentAmounts(siblingPayments ?? []);
      const totalAmount =
        typeof order?.total_amount === "number" ? order.total_amount : Number(order?.total_amount ?? 0);

      return NextResponse.json({
        kind: "order",
        orderId: payment.order_id,
        totalAmount,
        totalPaid,
        payment: {
          id: payment.id,
          payment_date: payment.payment_date,
          amount_total:
            typeof payment.amount_total === "number" ? payment.amount_total : Number(payment.amount_total ?? 0),
          payment_method: payment.payment_method,
          payment_status: payment.payment_status,
          due_date: payment.due_date,
          reference_number: payment.reference_number,
          check_number: payment.check_number,
          account_id: payment.account_id,
          notes: payment.notes,
          // Not used by EditPaymentDialog itself — kept only to satisfy
          // PaymentItem's shape without a second (unnecessary) fetch.
          insertedByLabel: null,
          morningDocuments: [],
        },
      });
    }

    if (payment.project_id) {
      const [{ data: project, error: projectError }, vatRate] = await Promise.all([
        supabase
          .from("projects")
          .select("project_type,start_date,vat_rate,price_includes_vat")
          .eq("id", payment.project_id)
          .maybeSingle(),
        getCurrentVatRate(supabase),
      ]);
      if (projectError) return NextResponse.json({ error: toHebrewError(projectError.message) }, { status: 400 });

      return NextResponse.json({
        kind: "project",
        projectId: payment.project_id,
        projectType: typeof project?.project_type === "string" ? project.project_type : null,
        projectStartDate: typeof project?.start_date === "string" ? project.start_date : null,
        vatRate:
          project?.price_includes_vat && typeof project.vat_rate === "number" && project.vat_rate > 0
            ? project.vat_rate
            : vatRate,
        priceIncludesVat: project?.price_includes_vat === true,
        payment,
      });
    }

    return NextResponse.json({ kind: "standalone", payment });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
