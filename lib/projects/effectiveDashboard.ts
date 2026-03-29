import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDERS_GLOBAL_PROJECT_ID } from "@/lib/orders/globalProject";

type Row = Record<string, unknown>;

const PAYMENTS_SCAN_CHUNK = 500;

function getString(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function getOrderPaymentsTotal(supabase: SupabaseClient) {
  let total = 0;

  for (let from = 0; ; from += PAYMENTS_SCAN_CHUNK) {
    const to = from + PAYMENTS_SCAN_CHUNK - 1;
    const { data, error } = await supabase
      .from("payments")
      .select("amount_total")
      .eq("target_type", "order")
      .order("payment_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = (data ?? []) as Array<{ amount_total?: number | string | null }>;
    rows.forEach((row) => {
      const amount =
        typeof row.amount_total === "number"
          ? row.amount_total
          : typeof row.amount_total === "string"
            ? Number(row.amount_total)
            : 0;
      total += Number.isFinite(amount) ? amount : 0;
    });

    if (rows.length < PAYMENTS_SCAN_CHUNK) break;
  }

  return total;
}

export async function applyEffectiveProjectDashboardRows<T extends Row>(
  supabase: SupabaseClient,
  rows: T[]
): Promise<T[]> {
  if (!rows.some((row) => getString(row, "id") === ORDERS_GLOBAL_PROJECT_ID)) {
    return rows;
  }

  const orderPaymentsTotal = await getOrderPaymentsTotal(supabase);

  return rows.map((row) => {
    if (getString(row, "id") !== ORDERS_GLOBAL_PROJECT_ID) {
      return row;
    }

    const totalExpenses = getNumber(row, "total_expenses") ?? 0;

    return {
      ...row,
      gross_profit: orderPaymentsTotal - totalExpenses,
    };
  });
}

export async function applyEffectiveProjectDashboardRow<T extends Row>(
  supabase: SupabaseClient,
  row: T | null
): Promise<T | null> {
  if (!row) return row;
  const [effectiveRow] = await applyEffectiveProjectDashboardRows(supabase, [row]);
  return effectiveRow ?? row;
}
