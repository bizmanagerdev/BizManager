// The incoming half of "what happens every month": rent from a live lease,
// repayments on money the business lent out, and the credit-card clearing
// deposit. The mirror of lib/outflow-sources.ts, which does the same for
// salaries, loan repayments and card charges.
//
// These rows deliberately carry NO settings. `outflow_source_settings` only
// knows salary / loan / card (a CHECK constraint), and an incoming source has
// nothing to configure yet anyway: you don't choose which account rent lands
// in, the lease does. They are listed, not managed — `configurable: false`
// says so, and the list renders them without controls rather than with dead
// ones.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLoans } from "@/lib/loans";
import { propertyDisplayName } from "@/lib/properties";
import type { InflowSourceKind, OutflowSourceRow } from "@/lib/outflow-source-settings";

type Row = Record<string, unknown>;
function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}
function num(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The next occurrence of `dayOfMonth` on or after `todayIso`, clamped to short
 * months. Used for anything that repeats monthly on a fixed day.
 */
export function nextMonthlyDate(dayOfMonth: number, todayIso: string): string {
  const [y, m, d] = todayIso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return todayIso;
  for (let i = 0; i < 2; i += 1) {
    const monthIndex = m - 1 + i;
    const last = new Date(y, monthIndex + 1, 0).getDate();
    const candidate = new Date(y, monthIndex, Math.min(dayOfMonth, last));
    if (isoLocal(candidate) >= todayIso) return isoLocal(candidate);
  }
  const last = new Date(y, m + 1, 0).getDate();
  return isoLocal(new Date(y, m + 1, Math.min(dayOfMonth, last)));
}

/** A row in the shared list, marked incoming and not configurable. */
function inflowRow(
  partial: Pick<OutflowSourceRow, "kind" | "key" | "name" | "scheduleLabel" | "nextDate" | "amount" | "href"> &
    Partial<OutflowSourceRow>
): OutflowSourceRow {
  return {
    focusId: null,
    reminderWorkDaysBefore: null,
    effectiveReminderDays: 0,
    accountId: null,
    isActive: true,
    settled: false,
    monthly: true,
    direction: "in",
    configurable: false,
    ...partial,
  };
}

/** Rent expected every month, one row per active lease. */
export async function loadRentSources(
  supabase: SupabaseClient,
  { todayIso }: { todayIso: string }
): Promise<OutflowSourceRow[]> {
  const { data, error } = await supabase
    .from("lease_agreements")
    .select("id,property_id,start_date,end_date,monthly_rent_amount,status")
    .eq("status", "active");
  if (error || !data) return [];

  const rows = (data as Row[]).filter((r) => num(r, "monthly_rent_amount") > 0 && str(r, "start_date"));
  const propertyIds = Array.from(new Set(rows.map((r) => str(r, "property_id")).filter((v): v is string => Boolean(v))));
  if (propertyIds.length === 0) return [];

  const { data: props } = await supabase.from("properties").select("id,name,address").in("id", propertyIds);
  const labelById = new Map<string, string>();
  for (const r of ((props ?? []) as Row[])) {
    const id = str(r, "id");
    if (id) labelById.set(id, propertyDisplayName({ name: str(r, "name"), address: str(r, "address") ?? "" }));
  }

  return rows.flatMap((r) => {
    const id = str(r, "id");
    const propertyId = str(r, "property_id");
    const start = str(r, "start_date");
    if (!id || !propertyId || !start) return [];
    // The lease has no rent day-of-month column, so its start day is the day.
    const day = Number(start.slice(8, 10)) || 1;
    const end = str(r, "end_date");
    const next = nextMonthlyDate(day, todayIso);
    // A lease that has already ended is not monthly income any more.
    if (end && next > end.slice(0, 10)) return [];
    const label = labelById.get(propertyId) ?? "נכס";
    return [
      inflowRow({
        kind: "rent",
        key: id,
        name: `שכר דירה — ${label}`,
        scheduleLabel: `${day} לכל חודש`,
        nextDate: next,
        amount: num(r, "monthly_rent_amount"),
        href: `/properties/${propertyId}`,
      }),
    ];
  });
}

/**
 * Money owed TO the business on loans it gave out. Only loans whose remaining
 * plan really is monthly count as a monthly arrival; a single bullet repayment
 * years out is listed but not counted, exactly as on the outgoing side.
 */
export async function loadLoanInflowSources(
  supabase: SupabaseClient,
  { todayIso }: { todayIso: string }
): Promise<OutflowSourceRow[]> {
  const loans = await fetchLoans(supabase).catch(() => []);
  return loans.flatMap((loan) => {
    if (loan.direction !== "given") return [];
    const planned = loan.plannedInstallments.filter((r) => r.repayment_date >= todayIso);
    if (planned.length === 0) return [];
    const next = planned[0];
    const dates = planned.map((r) => r.repayment_date);
    const monthly = isMonthlyPlanDates(dates);
    return [
      inflowRow({
        kind: "loan_in",
        key: loan.id,
        name: `החזר הלוואה — ${loan.borrower || "ללא שם"}`,
        scheduleLabel: monthly ? `${Number(next.repayment_date.slice(8, 10))} לכל חודש` : "תשלום חד-פעמי",
        nextDate: next.repayment_date,
        focusId: `loan_planned:${next.id}`,
        amount: next.amount,
        href: `/financial/loans/${loan.id}`,
        monthly,
      }),
    ];
  });
}

/** Two or more remaining dates, each a month apart — the same test the outgoing side uses. */
function isMonthlyPlanDates(dates: string[]): boolean {
  if (dates.length < 2) return false;
  const sorted = [...dates].sort();
  for (let i = 1; i < sorted.length; i += 1) {
    const a = new Date(sorted[i - 1]);
    const b = new Date(sorted[i]);
    const gap = Math.round((b.getTime() - a.getTime()) / 86_400_000);
    if (gap < 27 || gap > 32) return false;
  }
  return true;
}

/**
 * The credit-card clearing deposit. Its amount is never known ahead (it is
 * whatever customers paid on the card), so it is a dated marker, like the
 * outgoing card charge.
 */
export async function loadSettlementSource(
  supabase: SupabaseClient,
  { todayIso }: { todayIso: string }
): Promise<OutflowSourceRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("due_date,payment_date,payment_method,payment_status")
    .eq("payment_method", "credit_card")
    .not("due_date", "is", null)
    .gte("due_date", todayIso)
    .order("due_date", { ascending: true })
    .limit(1);
  if (error) return [];
  const row = ((data ?? []) as Row[])[0];
  const due = row ? str(row, "due_date") : null;
  if (!due) return [];
  const day = Number(due.slice(8, 10)) || 10;
  return [
    inflowRow({
      kind: "settlement",
      key: "grow",
      name: "אשראי משולם (גרואו)",
      scheduleLabel: `${day} לכל חודש · לפי הסליקה`,
      nextDate: due.slice(0, 10),
      // Unknown until the batch settles — same reasoning as a card charge.
      amount: null,
      href: "/financial/bank",
      monthly: false,
    }),
  ];
}

/** Every incoming source, best-effort: one unreadable table costs its own rows. */
export async function loadInflowSources(
  supabase: SupabaseClient,
  { todayIso }: { todayIso: string }
): Promise<OutflowSourceRow[]> {
  const [rent, loans, settlement] = await Promise.all([
    loadRentSources(supabase, { todayIso }).catch(() => [] as OutflowSourceRow[]),
    loadLoanInflowSources(supabase, { todayIso }).catch(() => [] as OutflowSourceRow[]),
    loadSettlementSource(supabase, { todayIso }).catch(() => [] as OutflowSourceRow[]),
  ]);
  return [...rent, ...loans, ...settlement];
}

export type { InflowSourceKind };
