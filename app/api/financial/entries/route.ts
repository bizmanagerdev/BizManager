import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { ensureRecurringExpensesForDate } from "@/lib/recurring-expenses";
import {
  cashFlowCustomerId,
  loadCashFlowData,
  loadCashFlowProjections,
  normalizeFinancialSearchParams,
  type CashFlowSearchParams,
} from "@/lib/financial/cashFlowPage";

// The full ledger and upcoming lists of /financial for the filters in the
// query string — the page itself is sent with only the newest rows
// (flowViewData), and FinancialPageClient loads these right after it, so
// search, the month list and the CSV export cover everything again. Built by
// the same loader the page uses (lib/financial/cashFlowPage). Admin-only,
// like the page.
export async function GET(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const url = new URL(req.url);
    const searchParams: CashFlowSearchParams = Object.fromEntries(url.searchParams.entries());

    // As on the page: today's recurring expenses exist before the ledger is read.
    await ensureRecurringExpensesForDate(supabase);
    const data = await loadCashFlowData(supabase, {
      filters: normalizeFinancialSearchParams(searchParams),
      customerId: cashFlowCustomerId(searchParams),
      notBefore: null,
      projectedOutflowEntries: loadCashFlowProjections(supabase),
    });
    return NextResponse.json(
      { ledgerEntries: data.ledgerEntries, upcomingEntries: data.upcomingEntries },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת התנועות נכשלה.") }, { status: 500 });
  }
}
