import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadAccounts, type Account } from "@/lib/accounts";

const ALLOWED_KINDS = new Set(["bank", "cash", "card"]);
const ALLOWED_CURRENCIES = new Set(["ILS", "USD", "CAD"]);

/**
 * RLS ("Staff manage accounts") already scopes reads/writes to admin+office —
 * matches the old /api/financial/accounts route now that its app-level
 * admin-only write gate was widened to match (2026-09-01, per user decision).
 *
 * A vehicles-access worker books expenses and income on a car but is NOT
 * admin/office, so that same policy hands him an empty list — and an empty list
 * makes AccountSelect's callers skip their "choose an account" guard and post
 * account_id: null (the length check is there for a business with no accounts
 * configured yet). The account_picker_options() RPC is the fallback: same
 * active accounts, picker fields only, no opening balances. See
 * supabase/migrations/20260908105000_account_picker_options.sql.
 */
export async function fetchAccountsDirect(): Promise<Account[]> {
  const supabase = createSupabaseBrowserClient();
  const accounts = await loadAccounts(supabase);
  if (accounts.length > 0) return accounts;

  const { data } = await supabase.rpc("account_picker_options");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const kind = typeof row.kind === "string" ? row.kind : "";
    return {
      id: typeof row.id === "string" ? row.id : "",
      name: (typeof row.name === "string" && row.name.trim()) || "חשבון",
      kind: (ALLOWED_KINDS.has(kind) ? kind : "bank") as Account["kind"],
      currency: "ILS",
      // Not exposed to this caller — the picker only ever reads id/name/kind.
      openingBalance: 0,
      openingDate: "1970-01-01",
      isActive: row.is_active !== false,
      sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
      notes: null,
    };
  });
}

export type SaveAccountInput = {
  id?: string;
  name: string;
  kind: string;
  /** ₪, US$ or C$. The database won't change it once the account has rows in
   *  another currency, and says so. */
  currency?: string;
  opening_balance: number;
  opening_date: string;
  is_active?: boolean;
  sort_order?: number;
  notes?: string | null;
  account_number?: string | null;
};

export async function saveAccountDirect(
  input: SaveAccountInput
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  if (!input.name.trim()) return { ok: false, error: "יש להזין שם לחשבון." };
  if (!ALLOWED_KINDS.has(input.kind)) return { ok: false, error: "סוג חשבון אינו תקין." };
  if (input.currency !== undefined && !ALLOWED_CURRENCIES.has(input.currency)) {
    return { ok: false, error: "מטבע החשבון אינו תקין." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.opening_date)) return { ok: false, error: "יש לבחור תאריך פתיחה." };

  const supabase = createSupabaseBrowserClient();
  if (input.id) {
    const { error } = await supabase
      .from("accounts")
      .update({
        name: input.name.trim(),
        kind: input.kind,
        ...(input.currency ? { currency: input.currency } : {}),
        opening_balance: input.opening_balance,
        opening_date: input.opening_date,
        is_active: input.is_active !== false,
        // Its place in the owner's order is the strip's to change, not the
        // edit form's — an edit that doesn't name one keeps it.
        ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
        notes: input.notes?.trim() || null,
        account_number: input.account_number?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // A new account joins the end of the owner's order.
  let sortOrder = input.sort_order;
  if (sortOrder === undefined) {
    const { data: last } = await supabase
      .from("accounts")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = (Number((last as { sort_order?: unknown } | null)?.sort_order) || 0) + 1;
  }
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: input.name.trim(),
      kind: input.kind,
      currency: input.currency ?? "ILS",
      opening_balance: input.opening_balance,
      opening_date: input.opening_date,
      notes: input.notes?.trim() || null,
      account_number: input.account_number?.trim() || null,
      sort_order: sortOrder,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string } | null)?.id };
}

/**
 * The accounts in the owner's own order (owner, 2026-10-25: "dragging accounts
 * to the order I want … right now it's alphabetical, I want custom order"):
 * each one's place, 1 on, as dragged on the חשבונות page. Kept on the account
 * itself, so every computer and phone — and every account picker — shows the
 * same order. Only the ones whose place changed are written.
 */
export async function saveAccountOrderDirect(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return { ok: false, error: "סדר לא תקין." };
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("accounts").select("id,sort_order").in("id", ids);
  if (error) return { ok: false, error: error.message };
  const placeNow = new Map(((data ?? []) as Array<{ id: string; sort_order: number | null }>).map((r) => [r.id, r.sort_order]));
  const moved = ids.map((id, index) => ({ id, place: index + 1 })).filter(({ id, place }) => placeNow.get(id) !== place);
  const results = await Promise.all(
    moved.map(({ id, place }) => supabase.from("accounts").update({ sort_order: place }).eq("id", id))
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  return { ok: true };
}

export async function deleteAccountDirect(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // FK is ON DELETE SET NULL, so this un-assigns the account from any
  // payment/expense rather than removing them.
  const { error } = await createSupabaseBrowserClient().from("accounts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
