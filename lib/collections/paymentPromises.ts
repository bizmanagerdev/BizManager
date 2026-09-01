import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const STATUS_VALUES = new Set(["pending", "kept", "broken", "cancelled"]);

export type PaymentPromiseUpdate = {
  status?: "pending" | "kept" | "broken" | "cancelled";
  amount?: number;
  promised_date?: string;
  notes?: string;
};

/**
 * RLS ("Staff manage payment promises") matches the old route's admin/office
 * gate exactly.
 */
export async function updatePaymentPromise(id: string, input: PaymentPromiseUpdate): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, error: "יש להתחבר מחדש." };
  const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", authUser.id).maybeSingle();
  const myId = (me as { id?: string } | null)?.id;
  if (!myId) return { ok: false, error: "לא ניתן לזהות את המשתמש." };

  const updates: Record<string, unknown> = { updated_by: myId, updated_at: new Date().toISOString() };
  if (input.status && STATUS_VALUES.has(input.status)) updates.status = input.status;
  if (input.amount !== undefined && Number.isFinite(input.amount) && input.amount > 0) updates.amount = input.amount;
  if (input.promised_date?.trim()) updates.promised_date = input.promised_date.trim();
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;

  const { data, error } = await supabase.from("payment_promises").update(updates).eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "ההבטחה לא נמצאה או שאין הרשאה לעדכן אותה." };
  return { ok: true };
}
