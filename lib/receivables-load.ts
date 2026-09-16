// Server-side loader for the incoming half of the board. Kept apart from the
// pure mapping in lib/receivables.ts so that stays testable without a client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialEntry } from "@/lib/financial/types";
import type { PaymentCalendarItem } from "@/lib/payables";
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
import { getCurrentCcFeeRate } from "@/lib/settings/ccFee";
import { propertyDisplayName } from "@/lib/properties";

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
    .select("id,customer_id,order_id,project_id,amount,promised_date,notes")
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
    }))
    .filter((p) => p.id && p.promisedDate);
}

/**
 * Deferred card settlements: a credit_card payment whose due_date differs from
 * its payment_date is money the clearing company pays us later. Read straight
 * from `payments` rather than from the ledger entries, because the engine has
 * already flattened these onto the customer's pay date.
 */
export async function loadSettlementRows(
  supabase: SupabaseClient,
  { fromIso }: { fromIso: string }
): Promise<SettlementPaymentRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id,account_id,payment_date,due_date,amount_total,payment_method,payment_status")
    .eq("payment_method", "credit_card")
    .not("due_date", "is", null)
    .gte("due_date", fromIso);
  if (error) return [];
  return ((data ?? []) as Row[])
    .filter((r) => (str(r, "payment_status") ?? "").trim().toLowerCase() !== "rejected")
    .map((r) => ({
      id: str(r, "id") ?? "",
      accountId: str(r, "account_id"),
      paymentDate: (str(r, "payment_date") ?? "").slice(0, 10),
      dueDate: (str(r, "due_date") ?? "").slice(0, 10),
      amount: num(r, "amount_total"),
    }))
    .filter((r) => r.id && r.amount > 0);
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
): Promise<{ leases: LeaseRow[]; bookedMonths: Map<string, Set<string>> }> {
  const { data, error } = await supabase
    .from("lease_agreements")
    .select("id,property_id,customer_id,start_date,end_date,monthly_rent_amount,status")
    .eq("status", "active");
  if (error || !data) return { leases: [], bookedMonths: new Map() };

  const rows = (data ?? []) as Row[];
  const propertyIds = Array.from(new Set(rows.map((r) => str(r, "property_id")).filter((v): v is string => Boolean(v))));
  if (propertyIds.length === 0) return { leases: [], bookedMonths: new Map() };

  const [propsResult, paidResult] = await Promise.all([
    supabase.from("properties").select("id,name,address").in("id", propertyIds),
    supabase
      .from("payments")
      .select("property_id,payment_date")
      .in("property_id", propertyIds)
      .gte("payment_date", fromIso),
  ]);

  const labelById = new Map<string, string>();
  for (const r of ((propsResult.data ?? []) as Row[])) {
    const id = str(r, "id");
    if (id) labelById.set(id, propertyDisplayName({ name: str(r, "name"), address: str(r, "address") ?? "" }));
  }

  const bookedMonths = new Map<string, Set<string>>();
  for (const r of ((paidResult.data ?? []) as Row[])) {
    const propertyId = str(r, "property_id");
    const date = str(r, "payment_date");
    if (!propertyId || !date) continue;
    const set = bookedMonths.get(propertyId) ?? new Set<string>();
    set.add(date.slice(0, 7));
    bookedMonths.set(propertyId, set);
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
    }))
    .filter((l) => l.id && l.propertyId && l.startDate && l.monthlyAmount > 0);

  return { leases, bookedMonths };
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
  const inflows = entries.filter((e) => e.type === "inflow");

  // Each forecast source is independent and best-effort: one unreadable table
  // costs its own rows, never the board.
  const [terms, customerNames, promises, settlementRows, feeRate, rent] = await Promise.all([
    loadReceivableTerms(supabase, inflows).catch(() => new Map<string, ReceivableTerms>()),
    loadCustomerNames(supabase, inflows).catch(() => new Map<string, string>()),
    loadOpenPromises(supabase, { fromIso }).catch(() => [] as PaymentPromise[]),
    loadSettlementRows(supabase, { fromIso }).catch(() => [] as SettlementPaymentRow[]),
    getCurrentCcFeeRate(supabase).catch(() => 0),
    loadLeasesAndBookedMonths(supabase, { fromIso }).catch(() => ({ leases: [] as LeaseRow[], bookedMonths: new Map<string, Set<string>>() })),
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
  const batches = groupSettlementBatches(settlementRows);

  return [
    // A promise reduces the debt it was made about, and a settled card payment
    // is replaced by the deposit that actually reaches the bank.
    ...dropSettledCardPayments(suppressPromisedReceivables(ledgerItems, promises), batches),
    ...toPromiseItems(promises, referenceDate, customerNames),
    ...toSettlementItems(batches, feeRate, referenceDate),
    ...projectRent(rent.leases, rent.bookedMonths, { fromIso, toIso, todayIso: referenceDate }),
  ];
}
