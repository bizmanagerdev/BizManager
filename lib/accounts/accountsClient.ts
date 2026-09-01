import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadAccounts, type Account } from "@/lib/accounts";

const ALLOWED_KINDS = new Set(["bank", "cash", "card"]);

/**
 * RLS ("Staff manage accounts") already scopes reads/writes to admin+office —
 * matches the old /api/financial/accounts route now that its app-level
 * admin-only write gate was widened to match (2026-09-01, per user decision).
 */
export async function fetchAccountsDirect(): Promise<Account[]> {
  return loadAccounts(createSupabaseBrowserClient());
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

export async function saveAccountDirect(input: SaveAccountInput): Promise<{ ok: true } | { ok: false; error: string }> {
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

  const { error } = await supabase.from("accounts").insert({
    name: input.name.trim(),
    kind: input.kind,
    opening_balance: input.opening_balance,
    opening_date: input.opening_date,
    notes: input.notes?.trim() || null,
    sort_order: input.sort_order ?? 0,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteAccountDirect(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // FK is ON DELETE SET NULL, so this un-assigns the account from any
  // payment/expense rather than removing them.
  const { error } = await createSupabaseBrowserClient().from("accounts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
