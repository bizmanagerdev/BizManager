// Server-side loader for the incoming half of the board. Kept apart from the
// pure mapping in lib/receivables.ts so that stays testable without a client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialEntry } from "@/lib/financial/types";
import type { PaymentCalendarItem } from "@/lib/payables";
import { MONEY_CURRENCY_COLUMNS, readForeignMoney } from "@/lib/fx/currencies";
import { receivableSourceIds, toIncomeCalendarItems, type ReceivableTerms } from "@/lib/receivables";
import {
  dropSettledCardPayments,
  groupSettlementBatches,
  projectRent,
  suppressPromisedReceivables,
  toPromiseItems,
  toSettlementItems,
  type LeaseRow,
  type PaymentPromise,
  type SettlementPaymentRow,
} from "@/lib/receivables-forecast";
import { propertyDisplayName } from "@/lib/properties";
import {
  cardScanSince,
  cardSettlementDate,
  labelSettlementPayments,
  loadSettlementConfirmations,
  NO_CONFIRMATIONS,
  settlementAccountFor,
} from "@/lib/card-settlements";
import { rentDayOf } from "@/lib/inflow-sources";
import { rentAllocationOf, type RentPayment } from "@/lib/property-rent";

type Row = Record<string, unknown>;
function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}
function num(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

/**
 * Payment terms + status for the orders/projects behind the receivables in
 * `entries`, keyed by that id. Best-effort: a failure here costs the board its
 * accurate dates, not its rows, so the caller still gets items.
 */
export async function loadReceivableTerms(
  supabase: SupabaseClient,
  entries: FinancialEntry[]
): Promise<Map<string, ReceivableTerms>> {
  const { orderIds, projectIds } = receivableSourceIds(entries);
  const map = new Map<string, ReceivableTerms>();
  const read = async (table: "orders" | "projects", ids: string[]) => {
    if (ids.length === 0) return;
    const { data, error } = await supabase.from(table).select("id,due_date,payment_terms,status").in("id", ids);
    if (error) return;
    for (const row of (data ?? []) as Row[]) {
      const id = str(row, "id");
      if (id) map.set(id, { dueDate: str(row, "due_date"), paymentTerms: str(row, "payment_terms"), status: str(row, "status") });
    }
  };
  await Promise.all([read("orders", orderIds), read("projects", projectIds)]);
  return map;
}

/** Names for a known set of customer ids. Best-effort. */
export async function loadCustomerNamesByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data, error } = await supabase.from("customers").select("id,name").in("id", unique);
  if (error) return map;
  for (const row of (data ?? []) as Row[]) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (id && name) map.set(id, name);
  }
  return map;
}

/** Names for the customers an incoming row is from. Best-effort. */
export async function loadCustomerNames(
  supabase: SupabaseClient,
  entries: FinancialEntry[]
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(entries.map((e) => e.customerId).filter((id): id is string => Boolean(id))));
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.from("customers").select("id,name").in("id", ids);
  if (error) return map;
  for (const row of (data ?? []) as Row[]) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (id && name) map.set(id, name);
  }
  return map;
}

/**
 * Open payment promises in the window. Best-effort: the table is newer than the
 * money engine and a deployment without it must not cost the board its rows.
 */
export async function loadOpenPromises(
  supabase: SupabaseClient,
  { fromIso }: { fromIso: string }
): Promise<PaymentPromise[]> {
  const { data, error } = await supabase
    .from("payment_promises")
    .select(`id,customer_id,order_id,project_id,amount,promised_date,notes,${MONEY_CURRENCY_COLUMNS}`)
    .eq("status", "pending")
    .gte("promised_date", fromIso);
  if (error) return [];
  return ((data ?? []) as Row[])
    .map((r) => ({
      id: str(r, "id") ?? "",
      customerId: str(r, "customer_id"),
      orderId: str(r, "order_id"),
      projectId: str(r, "project_id"),
      amount: num(r, "amount"),
      promisedDate: str(r, "promised_date") ?? "",
      notes: str(r, "notes"),
      foreign: readForeignMoney(r),
    }))
    .filter((p) => p.id && p.promisedDate);
}

/**
 * Card payments, each dated on the deposit it lands in (the 10th of the next
 * month — see cardSettlementDate). Read straight from `payments` so they can be
 * grouped into deposits; the engine dates each one the same way, and the board
 * swaps those single rows for the deposit.
 *
 * The window matches the engine's payment scan exactly (payment_date reaching
 * back a month), so every card row on the board has its deposit.
 */
export async function loadSettlementRows(
  supabase: SupabaseClient,
  { fromIso }: { fromIso: string }
): Promise<SettlementPaymentRow[]> {
  const since = cardScanSince(fromIso);
  const { data, error } = await supabase
    .from("payments")
    .select("id,account_id,payment_date,due_date,amount_total,payment_method,payment_status,order_id,project_id,notes")
    .eq("payment_method", "credit_card")
    .or(`payment_date.gte.${since},due_date.gte.${since}`);
  if (error) return [];
  const base = ((data ?? []) as Row[])
    .filter((r) => (str(r, "payment_status") ?? "").trim().toLowerCase() !== "rejected")
    .map((r) => {
      const paymentDate = (str(r, "payment_date") ?? "").slice(0, 10);
      const amount = num(r, "amount_total");
      return {
        id: str(r, "id") ?? "",
        accountId: str(r, "account_id"),
        paymentDate,
        dueDate:
          cardSettlementDate({ paymentMethod: "credit_card", paymentDate, dueDate: str(r, "due_date"), amount }) ?? "",
        amount,
        orderId: str(r, "order_id"),
        projectId: str(r, "project_id"),
        notes: str(r, "notes"),
      };
    })
    .filter((r) => r.id && r.amount > 0 && r.dueDate);
  // Who each payment was from, so a deposit can be checked before it is confirmed.
  const labelled = await labelSettlementPayments(supabase, base).catch(() => []);
  const labelById = new Map(labelled.map((p) => [p.id, p.label] as const));
  return base.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    paymentDate: r.paymentDate,
    dueDate: r.dueDate,
    amount: r.amount,
    label: labelById.get(r.id),
  }));
}

/**
 * Active leases plus, per property, the rental months that already have a
 * payment row — so the projection only fills the gaps the office hasn't
 * generated. Rent rows carry the rental month in `payment_date` (the due_date
 * is when the post-dated check clears), which is why the months come from there.
 */
export async function loadLeasesAndBookedMonths(
  supabase: SupabaseClient,
  { fromIso }: { fromIso: string }
): Promise<{ leases: LeaseRow[]; bookedMonths: Map<string, Set<string>>; rentPayments: Map<string, RentPayment[]> }> {
  const { data, error } = await supabase
    .from("lease_agreements")
    .select("id,property_id,customer_id,start_date,end_date,monthly_rent_amount,rent_day_of_month,rent_calendar,rent_hebrew_day,period_months,status")
    .in("status", ["active", "ended"]);
  if (error || !data) return { leases: [], bookedMonths: new Map(), rentPayments: new Map() };

  // Running ones, and those that ended on a known day — what they didn't pay stays owed until paid (owner,
  // 2026-10-25). A cancelled one never ran.
  const rows = ((data ?? []) as Row[]).filter((r) => str(r, "status") === "active" || Boolean(str(r, "end_date")));
  const propertyIds = Array.from(new Set(rows.map((r) => str(r, "property_id")).filter((v): v is string => Boolean(v))));
  if (propertyIds.length === 0) return { leases: [], bookedMonths: new Map(), rentPayments: new Map() };

  const [propsResult, paidResult] = await Promise.all([
    supabase.from("properties").select("id,name,address").in("id", propertyIds),
    // Also a payment from before the window that says it pays a month inside it.
    supabase
      .from("payments")
      .select("property_id,payment_date,payment_status,amount_total,lease_id,rent_period_start,rent_periods,rent_allocation,counts_as_rent")
      .in("property_id", propertyIds)
      .or(`payment_date.gte.${fromIso},rent_period_start.gte.${fromIso.slice(0, 10)}`),
  ]);

  const labelById = new Map<string, string>();
  for (const r of ((propsResult.data ?? []) as Row[])) {
    const id = str(r, "id");
    if (id) labelById.set(id, propertyDisplayName({ name: str(r, "name"), address: str(r, "address") ?? "" }));
  }

  const bookedMonths = new Map<string, Set<string>>();
  // Which lease and month(s) each pays — what the projection checks (lib/property-rent.ts).
  const rentPayments = new Map<string, RentPayment[]>();
  for (const r of ((paidResult.data ?? []) as Row[])) {
    const propertyId = str(r, "property_id");
    const date = str(r, "payment_date");
    if (!propertyId || !date) continue;
    const set = bookedMonths.get(propertyId) ?? new Set<string>();
    set.add(date.slice(0, 7));
    bookedMonths.set(propertyId, set);
    const list = rentPayments.get(propertyId) ?? [];
    list.push({
      date,
      paymentStatus: str(r, "payment_status"),
      amount: num(r, "amount_total"),
      leaseId: str(r, "lease_id"),
      periodStart: str(r, "rent_period_start"),
      periods: num(r, "rent_periods") || 1,
      countsAsRent: r.counts_as_rent !== false,
      allocation: rentAllocationOf(r.rent_allocation),
    });
    rentPayments.set(propertyId, list);
  }

  const leases: LeaseRow[] = rows
    .map((r) => ({
      id: str(r, "id") ?? "",
      propertyId: str(r, "property_id") ?? "",
      customerId: str(r, "customer_id"),
      propertyLabel: labelById.get(str(r, "property_id") ?? "") ?? "\u05e0\u05db\u05e1",
      startDate: (str(r, "start_date") ?? "").slice(0, 10),
      endDate: str(r, "end_date"),
      monthlyAmount: num(r, "monthly_rent_amount"),
      // The agreed rent day; projectRent falls back to the start day when null.
      rentDay: rentDayOf(r, (str(r, "start_date") ?? "").slice(0, 10)),
      rentCalendar: str(r, "rent_calendar"),
      rentHebrewDay: num(r, "rent_hebrew_day") || null,
      periodMonths: num(r, "period_months") || 1,
    }))
    .filter((l) => l.id && l.propertyId && l.startDate && l.monthlyAmount > 0);

  return { leases, bookedMonths, rentPayments };
}

/**
 * The incoming calendar items for an already-loaded ledger. Takes the entries
 * rather than reading them again — the page loads the ledger once and hands the
 * same array to both directions.
 */
export async function loadIncomeCalendarItems(
  supabase: SupabaseClient,
  {
    entries,
    referenceDate,
    fromIso,
    toIso,
  }: { entries: FinancialEntry[]; referenceDate: string; fromIso: string; toIso: string }
): Promise<PaymentCalendarItem[]> {
  // Rent still owed is shown month by month by projectRent below — the ledger's rent debt rows would double it.
  const inflows = entries.filter((e) => e.type === "inflow" && e.origin !== "rent_receivable");

  // Each forecast source is independent and best-effort: one unreadable table
  // costs its own rows, never the board.
  const [terms, customerNames, promises, settlementRows, rent, confirmations] = await Promise.all([
    loadReceivableTerms(supabase, inflows).catch(() => new Map<string, ReceivableTerms>()),
    loadCustomerNames(supabase, inflows).catch(() => new Map<string, string>()),
    loadOpenPromises(supabase, { fromIso }).catch(() => [] as PaymentPromise[]),
    loadSettlementRows(supabase, { fromIso }).catch(() => [] as SettlementPaymentRow[]),
    loadLeasesAndBookedMonths(supabase, { fromIso }).catch(() => ({
      leases: [] as LeaseRow[],
      bookedMonths: new Map<string, Set<string>>(),
      rentPayments: new Map<string, RentPayment[]>(),
    })),
    loadSettlementConfirmations(supabase).catch(() => NO_CONFIRMATIONS),
  ]);

  // Promise names come from the same lookup the ledger rows use, plus whoever
  // only appears on a promise.
  const promiseCustomerIds = promises.map((p) => p.customerId).filter((id): id is string => Boolean(id));
  const missingNames = promiseCustomerIds.filter((id) => !customerNames.has(id));
  if (missingNames.length > 0) {
    const extra = await loadCustomerNamesByIds(supabase, missingNames).catch(() => new Map<string, string>());
    for (const [id, name] of extra) customerNames.set(id, name);
  }

  const ledgerItems = toIncomeCalendarItems(inflows, referenceDate, { terms, customerNames });
  // Every deposit is filed under the account chosen on the Grow row, if any.
  const batches = groupSettlementBatches(
    settlementRows.map((r) => ({ ...r, accountId: settlementAccountFor(r.accountId, confirmations) }))
  );

  return [
    // A promise reduces the debt it was made about, and a settled card payment
    // is replaced by the deposit that actually reaches the bank.
    ...dropSettledCardPayments(suppressPromisedReceivables(ledgerItems, promises), batches),
    ...toPromiseItems(promises, referenceDate, customerNames),
    ...toSettlementItems(batches, referenceDate, confirmations),
    ...projectRent(rent.leases, rent.bookedMonths, { fromIso, toIso, todayIso: referenceDate }, rent.rentPayments),
  ];
}
