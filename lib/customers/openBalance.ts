import type { SupabaseClient } from "@supabase/supabase-js";
import { splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { applyProjectVatToBase } from "@/lib/projects/vat";

/**
 * What a customer still owes across orders + projects.
 *
 * This is the same arithmetic the customer card draws in its חוב פתוח banner
 * (app/(app)/customers/[id]/page.tsx) — orders straight off `order_overview_view`
 * so the figures match the orders list, projects off `project_financials_view`
 * with the price-includes-VAT gross-up and the collected/pending payment split.
 * That page computes it inline because it needs the per-row breakdown anyway;
 * this helper exists for callers that only want the one number. If the banner's
 * math changes, change it here too.
 *
 * Best-effort: a missing view or a query error contributes 0 rather than
 * throwing, so a page that shows this as a secondary figure still renders.
 */
export type CustomerOpenBalance = {
  totalSales: number;
  totalPaid: number;
  /** totalSales − totalPaid, floored at 0. */
  openBalance: number;
};

type Row = Record<string, unknown>;

function n(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const s = (row: Row | null | undefined, key: string) =>
  typeof row?.[key] === "string" ? (row[key] as string) : "";

export async function getCustomerOpenBalance(
  supabase: SupabaseClient,
  customerId: string
): Promise<CustomerOpenBalance> {
  const [ordersRes, projectsRes] = await Promise.all([
    supabase
      .from("order_overview_view")
      .select("order_id,total_amount,collected_amount")
      .eq("customer_id", customerId),
    supabase
      .from("projects")
      .select("id,agreed_base_price,actual_price,price_includes_vat,vat_rate")
      .eq("customer_id", customerId),
  ]);

  const orders = (ordersRes.data ?? []) as Row[];
  const projects = (projectsRes.data ?? []) as Row[];

  let totalSales = 0;
  let totalPaid = 0;
  orders.forEach((order) => {
    totalSales += n(order.total_amount);
    totalPaid += n(order.collected_amount);
  });

  const projectIds = projects.map((row) => s(row, "id")).filter(Boolean);
  if (projectIds.length > 0) {
    const [financialsRes, paymentsRes] = await Promise.all([
      supabase
        .from("project_financials_view")
        .select("id,customer_total_price,expenses_billed")
        .in("id", projectIds),
      supabase
        .from("payments")
        .select("project_id,amount_total,net_amount,payment_status,due_date")
        .in("project_id", projectIds),
    ]);

    const financialByProjectId = new Map<string, Row>();
    ((financialsRes.data ?? []) as Row[]).forEach((row) => {
      const projectId = s(row, "id");
      if (projectId) financialByProjectId.set(projectId, row);
    });

    const paymentsByProjectId = new Map<string, Row[]>();
    ((paymentsRes.data ?? []) as Row[]).forEach((row) => {
      const projectId = s(row, "project_id");
      if (!projectId) return;
      const list = paymentsByProjectId.get(projectId) ?? [];
      list.push(row);
      paymentsByProjectId.set(projectId, list);
    });

    projects.forEach((row) => {
      const projectId = s(row, "id");
      const financialRow = financialByProjectId.get(projectId);
      const actualPrice = n(row.actual_price);
      const agreedBasePrice = n(row.agreed_base_price);
      const expensesBilled = n(financialRow?.expenses_billed);
      const baseNet = actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0;
      const fallbackTotal =
        applyProjectVatToBase(baseNet, {
          priceIncludesVat: row.price_includes_vat === true,
          vatRate: row.vat_rate as number | null,
        }) + expensesBilled;

      totalSales += Math.max(n(financialRow?.customer_total_price), fallbackTotal);
      totalPaid += splitPaymentAmounts(
        (paymentsByProjectId.get(projectId) ?? []).map((payment) => ({
          amount_total: n(payment.amount_total),
          // Raw, not n(): null must stay null so the split falls back to gross
          // for legacy rows instead of counting them as zero.
          net_amount: payment.net_amount as number | string | null,
          payment_status: s(payment, "payment_status") || null,
          due_date: s(payment, "due_date") || null,
        }))
      ).collected;
    });
  }

  return { totalSales, totalPaid, openBalance: Math.max(totalSales - totalPaid, 0) };
}
