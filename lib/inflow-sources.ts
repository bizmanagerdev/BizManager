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
import { cardScanSince, cardSettlementDate, labelSettlementPayments, loadSettlementAccountId } from "@/lib/card-settlements";

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

/** A lease's rent day: the agreed one, else the day it started. */
export function rentDayOf(row: { rent_day_of_month?: unknown }, startDate: string): number {
  const stored = row.rent_day_of_month;
  const n = typeof stored === "number" ? stored : typeof stored === "string" ? Number(stored) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 31) return Math.round(n);
  return Number(startDate.slice(8, 10)) || 1;
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
    .select("id,property_id,start_date,end_date,monthly_rent_amount,rent_day_of_month,status")
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
    // The agreed rent day when the lease has one; otherwise the day it started,
    // which is all the app had before the column existed.
    const day = rentDayOf(r, start);
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
 * The next credit-card clearing deposit. Its amount is the sum of the card
 * payments due to land in it — so it is not a guess: it is exactly what has
 * been taken so far, and it grows as more card payments are recorded for that
 * date. The row carries those payments, so the list can open and show them.
 */
export async function loadSettlementSource(
  supabase: SupabaseClient,
  { todayIso }: { todayIso: string }
): Promise<OutflowSourceRow[]> {
  const since = cardScanSince(todayIso);
  const accountPromise = loadSettlementAccountId(supabase);
  const { data, error } = await supabase
    .from("payments")
    .select("id,due_date,payment_date,payment_method,payment_status,amount_total,order_id,project_id,notes")
    .eq("payment_method", "credit_card")
    .or(`payment_date.gte.${since},due_date.gte.${todayIso}`);
  if (error) return [];

  // Every card payment, dated on the deposit it lands in; never bounced ones.
  const upcoming = ((data ?? []) as Row[])
    .filter((r) => (str(r, "payment_status") ?? "").trim().toLowerCase() !== "rejected")
    .map((r) => ({
      row: r,
      settles: cardSettlementDate({
        paymentMethod: "credit_card",
        paymentDate: str(r, "payment_date"),
        dueDate: str(r, "due_date"),
        amount: num(r, "amount_total"),
      }),
    }))
    .filter((p): p is { row: Row; settles: string } => Boolean(p.settles && p.settles >= todayIso));
  if (upcoming.length === 0) return [];

  // The NEXT deposit: every payment landing on the earliest upcoming date.
  const nextDate = upcoming.reduce((min, p) => (p.settles < min ? p.settles : min), upcoming[0].settles);
  const inNext = upcoming.filter((p) => p.settles === nextDate).map((p) => p.row);
  const breakdown = await labelSettlementPayments(
    supabase,
    inNext.map((r) => ({
      id: str(r, "id") ?? "",
      paymentDate: (str(r, "payment_date") ?? "").slice(0, 10),
      amount: num(r, "amount_total"),
      orderId: str(r, "order_id"),
      projectId: str(r, "project_id"),
      notes: str(r, "notes"),
    }))
  ).catch(() => []);
  const total = Math.round(inNext.reduce((sum, r) => sum + num(r, "amount_total"), 0) * 100) / 100;
  const accountId = await accountPromise;
  const day = Number(nextDate.slice(8, 10)) || 10;

  return [
    inflowRow({
      kind: "settlement",
      key: "grow",
      name: "אשראי משולם (גרואו)",
      scheduleLabel: `${day} לכל חודש · לפי הסליקה`,
      nextDate,
      amount: total,
      href: "/financial/bank",
      // Still not a FIXED monthly amount — it changes every month — so it
      // stays out of the monthly-income total even though it has a figure.
      monthly: false,
      breakdown,
      // The account the deposits land in — the one thing this row lets you set.
      configurable: "account",
      accountId,
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
