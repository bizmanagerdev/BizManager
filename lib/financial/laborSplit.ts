import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";

// ════════════════════════════════════════════════════════════════════════════
// Worker pay by the business area — and project — it was WORKED for.
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
//     on top (bonuses, manual adjustment) stays with the salary agreement.
//   • Monthly ("global") workers — the whole payslip to the agreement's area, or
//     the project it's tied to. The app doesn't let them log shifts
//     (payrollWorkerTypeAllowsSessions), so there is nothing to split by.
//
// One rule for both report bases:
//   • "הרווחתי" — loadEarnedLaborItems feeds the area totals (earnedRevenue), the
//     per-project breakdown and the per-area proof, in the month worked.
//   • "נכנס בפועל" / the dashboard chart — buildPayslipDomainShares gives each
//     paid or owed payslip its area shares (FinancialEntry.domainSplit).
// בית/צדקה and ניהול נכסים are shown in the earned reports from the cash
// figures, so their share moves in both at once and follows their checkboxes.
// The project page already charges those shifts to the project (labor_cost in
// project_financials_view), so the reports and the project pages agree.
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_DOMAIN = "general_business";

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
 * Shifts by worker and month. A shift belongs to the payslip of its clock_in
 * month in UTC — the same month the payslip generator and
 * session_effective_payment_view use.
 */
function indexShiftsByUserMonth(shiftRows: Row[]) {
  const shiftsByUserMonth = new Map<string, PayslipShift[]>();
  for (const row of shiftRows) {
    const userId = str(row.user_id);
    const clockIn = str(row.clock_in);
    if (!userId || !clockIn) continue;
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
  return shiftsByUserMonth;
}

const isPayslipRow = (row: Row) => (str(row.source_type) ?? "").toLowerCase() === "payslip";

/**
 * Each payslip's area shares (payslip id → shares adding up to 1), for the cash
 * reports: a payment or an open balance on that payslip divides the same way.
 * Only payslips worked in more than their agreement's area get an entry. Pure.
 */
export function buildPayslipDomainShares(
  debtRows: Row[],
  shiftRows: Row[]
): Map<string, Array<{ domain: string; share: number }>> {
  const shiftsByUserMonth = indexShiftsByUserMonth(shiftRows);
  const sharesById = new Map<string, Array<{ domain: string; share: number }>>();
  for (const row of debtRows) {
    if (!isPayslipRow(row)) continue;
    const payslipId = str(row.source_id);
    const userId = str(row.user_id);
    const month = str(row.period_month);
    const amount = Math.abs(toNum(row.earned_amount));
    if (!payslipId || !userId || !month || !(amount > 0)) continue;
    const domain = str(row.business_domain) ?? DEFAULT_DOMAIN;
    const parts = splitPayslipByShifts({ amount, domain, projectId: str(row.project_id) }, shiftsByUserMonth.get(`${userId}|${month}`) ?? []);
    const byDomain = new Map<string, number>();
    for (const part of parts) byDomain.set(part.domain, (byDomain.get(part.domain) ?? 0) + part.amount);
    if (byDomain.size === 1 && byDomain.has(domain)) continue;
    sharesById.set(
      payslipId,
      Array.from(byDomain, ([partDomain, partAmount]) => ({ domain: partDomain, share: partAmount / amount }))
    );
  }
  return sharesById;
}

/**
 * Turn worker_debt_items_view rows + the payslip workers' shifts into earned
 * labour items. Pure, so the split is testable without a database.
 */
export function buildEarnedLaborItems(debtRows: Row[], payslipShiftRows: Row[]): EarnedLaborItem[] {
  const shiftsByUserMonth = indexShiftsByUserMonth(payslipShiftRows);

  const items: EarnedLaborItem[] = [];
  for (const row of debtRows) {
    const amount = Math.abs(toNum(row.earned_amount));
    if (!(amount > 0)) continue;
    const userId = str(row.user_id);
    const month = str(row.period_month);
    const domain = str(row.business_domain) ?? DEFAULT_DOMAIN;
    const projectId = str(row.project_id);
    const date = str(row.source_date);
    if (!isPayslipRow(row)) {
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
        .filter(isPayslipRow)
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
