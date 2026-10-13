import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";

// ════════════════════════════════════════════════════════════════════════════
// Worker labour for the "הרווחתי" (earned) reports: each shekel of pay lands in
// the business area — and project — it was WORKED for, in the month it belongs to.
//
// Owner, 2026-10-13: "if a worker works for a project, even if his payslip is
// under שוטף, the money is going out of the project … an hourly worker who
// worked partly for שוטף, part for projects and part for orders — I need to see
// that in the projects and orders, not in שוטף. The global workers whose
// payslips are to שוטף, that's שוטף."
//
//   • Contract (session) workers — each shift as the view gives it: its own
//     area and project.
//   • Hourly payslip workers — the payslip is split by the shifts behind it:
//     each shift's cost to that shift's area/project; whatever the payslip adds
//     on top (bonuses, manual adjustment), and hours worked for בית/צדקה or
//     ניהול נכסים (see SPLIT_TO_DOMAINS), stay with the salary agreement.
//   • Monthly ("global") workers — the whole payslip to the agreement's area, or
//     the project it's tied to. The app doesn't let them log shifts
//     (payrollWorkerTypeAllowsSessions), so there is nothing to split by.
//
// The project page already charges those shifts to the project (labor_cost in
// project_financials_view), so the reports and the project pages now agree.
// One loader for all three earned reports — the domain totals (earnedRevenue),
// the per-project breakdown and the per-domain proof — so they can't drift apart.
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_DOMAIN = "general_business";
// The areas the earned reports show (BUSINESS_DOMAIN_ORDER in earnedRevenue).
// בית/צדקה and ניהול נכסים come into those reports from the CASH figures, where
// a payslip is paid under its agreement's area — so hours an hourly payslip
// worker spent on them stay in the agreement's area here too. Moving them would
// make that pay vanish from every row.
const SPLIT_TO_DOMAINS = new Set(["sales", "logistics_projects", "general_business", "spaceit"]);

export type EarnedLaborItem = {
  userId: string | null;
  projectId: string | null;
  /** Business area the pay was worked for; never empty. */
  domain: string;
  /** "YYYY-MM" the work belongs to (the shift's month / the payslip's month). */
  month: string | null;
  /** A day for proof labels: the latest shift in the part, else the item's own date. */
  date: string | null;
  amount: number;
};

export type PayslipShift = {
  domain: string | null;
  projectId: string | null;
  cost: number;
  date: string | null;
};

export type PayslipPart = { domain: string; projectId: string | null; amount: number; date: string | null };

/**
 * Split one payslip's pay by the shifts behind it. Shifts of the same area and
 * project are grouped into one part; what the payslip adds beyond the shifts goes
 * to the payslip's own area/project. The parts always add up to the payslip: if
 * the shifts come to more (a manual cut, a cost changed after the period locked),
 * each is scaled down by the same share. With no shifts the payslip stays whole.
 */
export function splitPayslipByShifts(
  payslip: { amount: number; domain: string; projectId: string | null },
  shifts: PayslipShift[]
): PayslipPart[] {
  if (!(payslip.amount > 0)) return [];
  const groups = new Map<string, PayslipPart>();
  let shiftTotal = 0;
  for (const shift of shifts) {
    const cost = shift.cost > 0 ? shift.cost : 0;
    if (cost === 0) continue;
    const domain = shift.domain || payslip.domain;
    const projectId = shift.projectId ?? null;
    const key = `${domain}|${projectId ?? ""}`;
    const group = groups.get(key) ?? { domain, projectId, amount: 0, date: null };
    group.amount += cost;
    if (shift.date && (!group.date || shift.date > group.date)) group.date = shift.date;
    groups.set(key, group);
    shiftTotal += cost;
  }
  if (shiftTotal === 0) {
    return [{ domain: payslip.domain, projectId: payslip.projectId, amount: payslip.amount, date: null }];
  }
  const scale = shiftTotal > payslip.amount ? payslip.amount / shiftTotal : 1;
  const parts = Array.from(groups.values(), (group) => ({ ...group, amount: group.amount * scale }));
  const rest = payslip.amount - shiftTotal * scale;
  if (rest > 0.005) parts.push({ domain: payslip.domain, projectId: payslip.projectId, amount: rest, date: null });
  return parts;
}

type Row = Record<string, unknown>;

function str(v: unknown) {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function toNum(v: unknown) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Turn worker_debt_items_view rows + the payslip workers' shifts into earned
 * labour items. Pure, so the split is testable without a database.
 * A shift belongs to the payslip of its clock_in month in UTC — the same month the
 * payslip generator and session_effective_payment_view use.
 */
export function buildEarnedLaborItems(debtRows: Row[], payslipShiftRows: Row[]): EarnedLaborItem[] {
  const shiftsByUserMonth = new Map<string, PayslipShift[]>();
  for (const row of payslipShiftRows) {
    const userId = str(row.user_id);
    const clockIn = str(row.clock_in);
    if (!userId || !clockIn) continue;
    const shiftDomain = str(row.business_domain);
    if (shiftDomain && !SPLIT_TO_DOMAINS.has(shiftDomain)) continue;
    const key = `${userId}|${clockIn.slice(0, 7)}`;
    const list = shiftsByUserMonth.get(key) ?? [];
    list.push({
      domain: str(row.business_domain),
      projectId: str(row.project_id),
      cost: toNum(row.labor_cost),
      date: clockIn.slice(0, 10),
    });
    shiftsByUserMonth.set(key, list);
  }

  const items: EarnedLaborItem[] = [];
  for (const row of debtRows) {
    const amount = Math.abs(toNum(row.earned_amount));
    if (!(amount > 0)) continue;
    const userId = str(row.user_id);
    const month = str(row.period_month);
    const domain = str(row.business_domain) ?? DEFAULT_DOMAIN;
    const projectId = str(row.project_id);
    const date = str(row.source_date);
    if ((str(row.source_type) ?? "").toLowerCase() !== "payslip") {
      items.push({ userId, projectId, domain, month, date, amount });
      continue;
    }
    const shifts = userId && month ? shiftsByUserMonth.get(`${userId}|${month}`) ?? [] : [];
    for (const part of splitPayslipByShifts({ amount, domain, projectId }, shifts)) {
      items.push({ userId, projectId: part.projectId, domain: part.domain, month, date: part.date ?? date, amount: part.amount });
    }
  }
  return items;
}

/**
 * Load every earned labour item. A read that fails (e.g. no access to pay data)
 * gives no labour rather than breaking the report, as before; if only the
 * shifts can't be read, payslips stay whole under their agreement.
 */
export async function loadEarnedLaborItems(supabase: SupabaseClient): Promise<EarnedLaborItem[]> {
  const debtRows = await fetchAllPaged<Row>((lo, hi) =>
    supabase
      .from("worker_debt_items_view")
      .select("source_type,source_id,user_id,project_id,business_domain,period_month,source_date,earned_amount")
      .order("source_type")
      .order("source_id")
      .range(lo, hi)
  ).catch(() => [] as Row[]);

  const payslipUserIds = Array.from(
    new Set(
      debtRows
        .filter((row) => (str(row.source_type) ?? "").toLowerCase() === "payslip")
        .map((row) => str(row.user_id))
        .filter((id): id is string => Boolean(id))
    )
  );
  const payslipShiftRows =
    payslipUserIds.length === 0
      ? []
      : await fetchAllPaged<Row>((lo, hi) =>
          supabase
            .from("attendance_sessions")
            .select("id,user_id,clock_in,labor_cost,business_domain,project_id")
            .in("user_id", payslipUserIds)
            .gt("labor_cost", 0)
            .order("id")
            .range(lo, hi)
        ).catch(() => [] as Row[]);

  return buildEarnedLaborItems(debtRows, payslipShiftRows);
}
