import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type MonthlySummaryPayload = {
  month?: string;
};

type Row = Record<string, unknown>;

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
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
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { month: trimmed, startDate, endDate };
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

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: projectRows, error: projectError } = await supabase
      .from("project_dashboard_view")
      .select(
        "id,status,project_type,start_date,agreed_base_price,actual_price,total_expenses,gross_profit"
      )
      .gte("start_date", bounds.startDate)
      .lte("start_date", bounds.endDate)
      .order("start_date", { ascending: true })
      .range(0, 4999);

    if (projectError) {
      return NextResponse.json({ error: toHebrewError(projectError.message) }, { status: 400 });
    }

    const projects = (projectRows ?? []) as Row[];
    const projectIds = projects
      .map((row) => (typeof row.id === "string" ? row.id : ""))
      .filter(Boolean);

    const [
      { data: paymentRows, error: paymentError },
      { data: financialRows, error: financialError },
      { data: workerBalanceRows, error: workerBalanceError },
    ] =
      projectIds.length > 0
        ? await Promise.all([
            supabase.from("payments").select("project_id,amount_total").in("project_id", projectIds),
            supabase
              .from("project_financials_view")
              .select("id,total_expenses,gross_profit,customer_total_price,expenses_billed")
              .in("id", projectIds),
            supabase
              .from("monthly_worker_balance_view")
              .select("period_month,owed_amount")
              .eq("period_month", bounds.month)
              .maybeSingle(),
          ])
        : [
            { data: [] as Row[], error: null },
            { data: [] as Row[], error: null },
            { data: null as Row | null, error: null },
          ];

    if (paymentError) {
      return NextResponse.json({ error: toHebrewError(paymentError.message) }, { status: 400 });
    }
    if (financialError) {
      return NextResponse.json({ error: toHebrewError(financialError.message) }, { status: 400 });
    }
    if (workerBalanceError) {
      return NextResponse.json({ error: toHebrewError(workerBalanceError.message) }, { status: 400 });
    }

    const paidTotalByProjectId = new Map<string, number>();
    ((paymentRows ?? []) as Row[]).forEach((row) => {
      const projectId = typeof row.project_id === "string" ? row.project_id : "";
      if (!projectId) return;
      const amount = toNumber(row.amount_total) ?? 0;
      paidTotalByProjectId.set(projectId, (paidTotalByProjectId.get(projectId) ?? 0) + amount);
    });

    const financialByProjectId = new Map<string, Row>();
    ((financialRows ?? []) as Row[]).forEach((row) => {
      const projectId = typeof row.id === "string" ? row.id : "";
      if (!projectId) return;
      financialByProjectId.set(projectId, row);
    });

    const typeCounts = new Map<string, number>();
    const statusCounts = new Map<string, number>();

    let totalCharged = 0;
    let totalPaid = 0;
    let totalExpenses = 0;
    let totalProfit = 0;
    let totalBasePrice = 0;
    let totalBilledExtras = 0;
    let totalQuoteCharged = 0;
    let totalQuoteCount = 0;
    const totalWorkerOwed = toNumber((workerBalanceRows as Row | null)?.owed_amount) ?? 0;

    projects.forEach((row) => {
      const projectId = typeof row.id === "string" ? row.id : "";
      const projectType = typeof row.project_type === "string" ? row.project_type : "unknown";
      const status = typeof row.status === "string" ? row.status : "unknown";
      typeCounts.set(projectType, (typeCounts.get(projectType) ?? 0) + 1);
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

      const financialRow = financialByProjectId.get(projectId) ?? null;
      const actualPrice = toNumber(row.actual_price);
      const agreedBasePrice = toNumber(row.agreed_base_price);
      const baseProjectPrice = agreedBasePrice ?? actualPrice ?? 0;
      const expensesBilled = toNumber(financialRow?.expenses_billed) ?? 0;
      const customerTotalPrice =
        toNumber(financialRow?.customer_total_price) ?? baseProjectPrice + expensesBilled;
      const expensesValue =
        toNumber(financialRow?.total_expenses) ?? toNumber(row.total_expenses) ?? 0;
      const grossProfit =
        toNumber(financialRow?.gross_profit) ?? toNumber(row.gross_profit) ?? 0;
      const paidTotal = paidTotalByProjectId.get(projectId) ?? 0;

      if (status === "quote") {
        totalQuoteCount += 1;
        totalQuoteCharged += customerTotalPrice;
        return;
      }

      totalCharged += customerTotalPrice;
      totalPaid += paidTotal;
      totalExpenses += expensesValue;
      totalProfit += grossProfit;
      totalBasePrice += baseProjectPrice;
      totalBilledExtras += expensesBilled;
    });

    return NextResponse.json({
      month: bounds.month,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      totalProjects: projects.length - totalQuoteCount,
      byType: Array.from(typeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
      byStatus: Array.from(statusCounts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
        totals: {
          charged: totalCharged,
          paid: totalPaid,
          expenses: totalExpenses,
          profit: totalProfit,
          basePrice: totalBasePrice,
          billedExtras: totalBilledExtras,
          workerOwed: totalWorkerOwed,
        },
      quotes: {
        count: totalQuoteCount,
        charged: totalQuoteCharged,
      },
    });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
