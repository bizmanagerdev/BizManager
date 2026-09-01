import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Delete a recurring expense/task template — straight to Supabase. RLS
 * ("Admins and office can manage recurring {expense,task} templates")
 * matches the old routes' admin/office allowedRoles gate exactly.
 */
export async function deleteRecurringExpenseTemplate(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createSupabaseBrowserClient().from("recurring_expense_templates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteRecurringTaskTemplate(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createSupabaseBrowserClient().from("recurring_task_templates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
