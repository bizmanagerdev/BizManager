import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { normalizeOrderStatus } from "@/lib/ui/status-colors";

type MonthlySummaryPayload = {
  month?: string;
};

type Row = Record<string, unknown>;

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseMonthBounds(value: string) {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const startDate = `${trimmed}-01`;
  // Exclusive upper bound = first day of the next month. Using `.lt` against this
  // works whether order_date is stored as a plain date or a timestamp.
  const nextMonthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { month: trimmed, startDate, nextMonthStart, endDate };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as MonthlySummaryPayload;
    const month =
      typeof body.month === "string" && body.month.trim()
        ? body.month.trim()
        : new Date().toISOString().slice(0, 7);
    const bounds = parseMonthBounds(month);
    if (!bounds) {
      return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    }

    // The monthly orders summary is an admin-only feature.
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: orderRows, error: orderError } = await supabase
      .from("order_overview_view")
      .select(
        "order_id,status,payment_status,order_date,total_amount,total_paid,remaining_balance,overdue_amount,needs_invoice,invoice_sent_at"
      )
      .gte("order_date", bounds.startDate)
      .lt("order_date", bounds.nextMonthStart)
      .order("order_date", { ascending: true })
      .range(0, 9999);

    if (orderError) {
      return NextResponse.json({ error: toHebrewError(orderError.message) }, { status: 400 });
    }

    const orders = (orderRows ?? []) as Row[];

    const statusCounts = new Map<string, number>();
    const paymentCounts = new Map<string, number>();

    let totalAmount = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalCredit = 0;
    let totalOverdue = 0;
    let needsInvoiceCount = 0;

    orders.forEach((row) => {
      const status =
        normalizeOrderStatus(typeof row.status === "string" ? row.status : "") || "unknown";
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

      const amount = toNumber(row.total_amount) ?? 0;
      const collected = toNumber(row.total_paid) ?? 0;
      const remaining = toNumber(row.remaining_balance) ?? Math.max(amount - collected, 0);
      // Overpayment / customer credit: money collected beyond this order's total.
      // The view clamps remaining_balance at 0 for these, so we surface the excess
      // explicitly instead of hiding it — keeps every figure reconciled:
      // booked = (collected − credit) + outstanding.
      const credit = Math.max(collected - amount, 0);
      const overdue = toNumber(row.overdue_amount) ?? 0;

      totalAmount += amount;
      totalPaid += collected;
      totalOutstanding += remaining;
      totalCredit += credit;
      totalOverdue += overdue;

      // payment_status comes straight from the view (collected-only basis), so the
      // breakdown matches how each order's status renders everywhere else.
      const paymentStatus =
        typeof row.payment_status === "string" && row.payment_status ? row.payment_status : "unpaid";
      paymentCounts.set(paymentStatus, (paymentCounts.get(paymentStatus) ?? 0) + 1);

      const needsInvoice = row.needs_invoice === true;
      const invoiceSent =
        typeof row.invoice_sent_at === "string" && row.invoice_sent_at.trim().length > 0;
      if (needsInvoice && !invoiceSent) needsInvoiceCount += 1;
    });

    return NextResponse.json({
      month: bounds.month,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      totalOrders: orders.length,
      byStatus: Array.from(statusCounts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
      byPayment: Array.from(paymentCounts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
      totals: {
        amount: totalAmount,
        paid: totalPaid,
        outstanding: totalOutstanding,
        credit: totalCredit,
        overdue: totalOverdue,
        needsInvoice: needsInvoiceCount,
      },
    });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
