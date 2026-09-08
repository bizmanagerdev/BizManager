import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadAccounts, type Account } from "@/lib/accounts";

const ALLOWED_KINDS = new Set(["bank", "cash", "card"]);

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
  opening_balance: number;
  opening_date: string;
  is_active?: boolean;
  sort_order?: number;
  notes?: string | null;
};

export async function saveAccountDirect(
  input: SaveAccountInput
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  if (!input.name.trim()) return { ok: false, error: "יש להזין שם לחשבון." };
  if (!ALLOWED_KINDS.has(input.kind)) return { ok: false, error: "סוג חשבון אינו תקין." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.opening_date)) return { ok: false, error: "יש לבחור תאריך פתיחה." };

  const supabase = createSupabaseBrowserClient();
  if (input.id) {
    const { error } = await supabase
      .from("accounts")
      .update({
        name: input.name.trim(),
        kind: input.kind,
        opening_balance: input.opening_balance,
        opening_date: input.opening_date,
        is_active: input.is_active !== false,
        sort_order: input.sort_order ?? 0,
        notes: input.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: input.name.trim(),
      kind: input.kind,
      opening_balance: input.opening_balance,
      opening_date: input.opening_date,
      notes: input.notes?.trim() || null,
      sort_order: input.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string } | null)?.id };
}

export async function deleteAccountDirect(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // FK is ON DELETE SET NULL, so this un-assigns the account from any
  // payment/expense rather than removing them.
  const { error } = await createSupabaseBrowserClient().from("accounts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
