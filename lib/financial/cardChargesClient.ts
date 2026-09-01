import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { norm } from "@/lib/financial/cardImport";

type Result = { ok: true; id: string } | { ok: false; error: string };

/**
 * RLS on `card_statement_charges`/`card_account_mappings` (both "Staff manage
 * ..." — admin/office) matches the old route's admin/office gate exactly.
 */
export async function saveCardCharge(input: {
  statement_id: string;
  card_label: string;
  account_id: string;
  amount: number;
  charge_date: string;
  notes?: string | null;
}): Promise<Result> {
  if (!input.statement_id) return { ok: false, error: "חסר מזהה פירוט." };
  if (!input.card_label.trim()) return { ok: false, error: "חסר שם כרטיס." };
  if (!input.account_id) return { ok: false, error: "יש לבחור חשבון." };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, error: "יש להזין סכום תקין." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.charge_date)) return { ok: false, error: "יש לבחור תאריך חיוב." };

  const supabase = createSupabaseBrowserClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const { data: me } = authUser
    ? await supabase.from("users").select("id").eq("auth_user_id", authUser.id).maybeSingle()
    : { data: null };
  const myId = (me as { id?: string } | null)?.id ?? null;

  const { data, error } = await supabase
    .from("card_statement_charges")
    .upsert(
      {
        statement_id: input.statement_id,
        card_label: input.card_label.trim(),
        account_id: input.account_id,
        amount: input.amount,
        charge_date: input.charge_date,
        notes: input.notes?.trim() || null,
        created_by: myId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "statement_id,card_label" }
    )
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const cardKey = norm(input.card_label);
  if (cardKey) {
    await supabase
      .from("card_account_mappings")
      .upsert(
        { card_key: cardKey, card_label: input.card_label.trim(), account_id: input.account_id, updated_by: myId, updated_at: new Date().toISOString() },
        { onConflict: "card_key" }
      );
  }

  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteCardCharge(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createSupabaseBrowserClient().from("card_statement_charges").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
