import type { SupabaseClient } from "@supabase/supabase-js";
import { monthKeyFromDate, monthLabelFromKey } from "@/lib/payroll";

type EnsureResult =
  | { ok: true; created: boolean; taskId: string | null }
  | { ok: false; error: string };

function dueDateForMonthKey(monthKey: string) {
  if (!monthKey || !monthKey.includes("-")) return "";
  return `${monthKey}-10`;
}

function salaryTaskSubject(monthKey: string) {
  const label = monthLabelFromKey(monthKey);
  return `תשלום משכורות - ${label}`;
}

function looksLikeNotNullViolation(message: string) {
  const value = message.toLowerCase();
  return value.includes("null value") && value.includes("violates not-null constraint");
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function ensureMonthlySalaryPaymentTask(
  supabase: SupabaseClient,
  options: { assignedUserId: string }
): Promise<EnsureResult> {
  const monthKey = monthKeyFromDate(new Date());
  const dueDate = dueDateForMonthKey(monthKey);
  const subject = salaryTaskSubject(monthKey);

  if (!dueDate || !subject || !options.assignedUserId) {
    return { ok: false, error: "Missing derived task fields." };
  }

  const existingResult = await supabase
    .from("tasks")
    .select("id")
    .eq("subject", subject)
    .eq("due_date", dueDate)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingResult.error) {
    return { ok: false, error: existingResult.error.message };
  }

  if (existingResult.data?.id) {
    return { ok: true, created: false, taskId: existingResult.data.id };
  }

  const insertResult = await supabase
    .from("tasks")
    .insert({
      project_id: null,
      customer_id: null,
      assigned_user_id: options.assignedUserId,
      subject,
      description: "משימה חודשית אוטומטית: לשלם משכורות עד ה-10 לחודש.",
      due_date: dueDate,
      priority: "high",
      status: "todo",
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (insertResult.error) {
    if (!looksLikeNotNullViolation(insertResult.error.message)) {
      return { ok: false, error: insertResult.error.message };
    }

    const fallbackProjectResult = await supabase
      .from("project_dashboard_view")
      .select("id,customer_id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<Record<string, unknown>>();

    if (fallbackProjectResult.error) {
      return { ok: false, error: insertResult.error.message };
    }

    const fallbackProjectId = getString(fallbackProjectResult.data?.id);
    const fallbackCustomerId = getString(fallbackProjectResult.data?.customer_id);

    if (!fallbackProjectId || !fallbackCustomerId) {
      return { ok: false, error: insertResult.error.message };
    }

    const fallbackInsertResult = await supabase
      .from("tasks")
      .insert({
        project_id: fallbackProjectId,
        customer_id: fallbackCustomerId,
        assigned_user_id: options.assignedUserId,
        subject,
        description: "משימה חודשית אוטומטית: לשלם משכורות עד ה-10 לחודש.",
        due_date: dueDate,
        priority: "high",
        status: "todo",
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (fallbackInsertResult.error) {
      return { ok: false, error: fallbackInsertResult.error.message };
    }

    return { ok: true, created: true, taskId: fallbackInsertResult.data?.id ?? null };
  }

  return { ok: true, created: true, taskId: insertResult.data?.id ?? null };
}
