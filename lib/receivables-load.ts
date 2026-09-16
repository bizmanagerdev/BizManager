// Server-side loader for the incoming half of the board. Kept apart from the
// pure mapping in lib/receivables.ts so that stays testable without a client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialEntry } from "@/lib/financial/types";
import type { PaymentCalendarItem } from "@/lib/payables";
import { receivableSourceIds, toIncomeCalendarItems, type ReceivableTerms } from "@/lib/receivables";

type Row = Record<string, unknown>;
function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
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
 * The incoming calendar items for an already-loaded ledger. Takes the entries
 * rather than reading them again — the page loads the ledger once and hands the
 * same array to both directions.
 */
export async function loadIncomeCalendarItems(
  supabase: SupabaseClient,
  { entries, referenceDate }: { entries: FinancialEntry[]; referenceDate: string }
): Promise<PaymentCalendarItem[]> {
  const inflows = entries.filter((e) => e.type === "inflow");
  if (inflows.length === 0) return [];
  const [terms, customerNames] = await Promise.all([
    loadReceivableTerms(supabase, inflows).catch(() => new Map<string, ReceivableTerms>()),
    loadCustomerNames(supabase, inflows).catch(() => new Map<string, string>()),
  ]);
  return toIncomeCalendarItems(inflows, referenceDate, { terms, customerNames });
}
