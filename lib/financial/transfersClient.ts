import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Result = { ok: true; id?: string } | { ok: false; error: string };

export type TransferInput = {
  id?: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  transfer_date: string;
  notes?: string | null;
};

function validate(input: TransferInput): string | null {
  if (!input.from_account_id) return "יש לבחור חשבון מקור.";
  if (!input.to_account_id) return "יש לבחור חשבון יעד.";
  if (input.from_account_id === input.to_account_id) return "לא ניתן להעביר לאותו חשבון.";
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "יש להזין סכום תקין.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transfer_date)) return "יש לבחור תאריך.";
  return null;
}

/**
 * RLS ("Staff manage account transfers", admin/office) matches the old
 * route's admin/office gate exactly. Audited by the generic trg_audit_
 * account_transfers trigger — no app-side audit call needed here either.
 */
export async function saveAccountTransfer(input: TransferInput): Promise<Result> {
  const validationError = validate(input);
  if (validationError) return { ok: false, error: validationError };

  const supabase = createSupabaseBrowserClient();
  if (input.id) {
    const { error } = await supabase
      .from("account_transfers")
      .update({
        from_account_id: input.from_account_id,
        to_account_id: input.to_account_id,
        amount: input.amount,
        transfer_date: input.transfer_date,
        notes: input.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const { data: me } = authUser
    ? await supabase.from("users").select("id").eq("auth_user_id", authUser.id).maybeSingle()
    : { data: null };
  const myId = (me as { id?: string } | null)?.id ?? null;

  const { data, error } = await supabase
    .from("account_transfers")
    .insert({
      from_account_id: input.from_account_id,
      to_account_id: input.to_account_id,
      amount: input.amount,
      transfer_date: input.transfer_date,
      notes: input.notes?.trim() || null,
      created_by: myId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteAccountTransfer(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createSupabaseBrowserClient().from("account_transfers").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
