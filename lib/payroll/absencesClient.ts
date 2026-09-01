import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { WORKER_ABSENCES_TABLE, WORKER_ABSENCE_COLUMNS, isWorkerAbsenceType, parseBonusDate } from "@/lib/payroll-bonuses";

/**
 * RLS ("worker_absences_staff_manage") matches the old route's admin/office
 * allowedRoles gate exactly.
 */
export async function createWorkerAbsences(input: {
  userIds: string[];
  absenceDate: string;
  absenceType?: string | null;
  paid?: boolean | null;
  notes?: string | null;
}): Promise<{ ok: true; added: number; skipped: number } | { ok: false; error: string }> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, error: "יש להתחבר מחדש." };
  const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", authUser.id).maybeSingle();
  const myId = (me as { id?: string } | null)?.id;
  if (!myId) return { ok: false, error: "לא ניתן לזהות את המשתמש." };

  const userIds = Array.from(new Set(input.userIds.map((id) => id.trim()).filter(Boolean)));
  const absenceDate = parseBonusDate(input.absenceDate);
  const absenceType = isWorkerAbsenceType(input.absenceType) ? input.absenceType : "day_off";
  const paid = input.paid === false ? false : true;
  const notes = input.notes?.trim().slice(0, 300) || null;

  if (userIds.length === 0) return { ok: false, error: "יש לבחור עובד." };
  if (!absenceDate) return { ok: false, error: "יש לבחור תאריך תקין." };

  const workersResult = await supabase.from("users").select("id").in("id", userIds);
  if (workersResult.error) return { ok: false, error: workersResult.error.message };
  const knownIds = new Set(((workersResult.data ?? []) as Array<{ id: string }>).map((row) => row.id));
  const validIds = userIds.filter((id) => knownIds.has(id));
  if (validIds.length === 0) return { ok: false, error: "העובד לא נמצא." };

  const existingResult = await supabase
    .from(WORKER_ABSENCES_TABLE)
    .select("user_id")
    .eq("absence_date", absenceDate)
    .in("user_id", validIds);
  if (existingResult.error) return { ok: false, error: existingResult.error.message };
  const alreadyMarked = new Set(((existingResult.data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id));
  const toInsert = validIds.filter((id) => !alreadyMarked.has(id));

  if (toInsert.length === 0) return { ok: true, added: 0, skipped: validIds.length };

  const insertResult = await supabase
    .from(WORKER_ABSENCES_TABLE)
    .insert(
      toInsert.map((userId) => ({
        user_id: userId,
        absence_date: absenceDate,
        absence_type: absenceType,
        paid,
        notes,
        created_by: myId,
      }))
    )
    .select(WORKER_ABSENCE_COLUMNS);
  if (insertResult.error) return { ok: false, error: insertResult.error.message };

  return { ok: true, added: insertResult.data?.length ?? 0, skipped: validIds.length - toInsert.length };
}

export async function deleteWorkerAbsence(absenceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createSupabaseBrowserClient().from(WORKER_ABSENCES_TABLE).delete().eq("id", absenceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
