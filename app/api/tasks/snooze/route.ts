import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { clientRowId } from "@/lib/client-row-id";

// "לטיפול בהמשך" — the signed-in person snoozes a task until a time, or brings
// it back (until: null). Per person: one row per task and person
// (task_snoozes; lib/tasks/snooze.ts). The table's own rules keep it to the
// person's own rows, on tasks they may open.
//
// Body: { task_id, until, id? } — snooze (or move the snooze) of that task;
// until null brings it back. Or { id, until } — the phone's change to a row it
// already has (its queue knows the row by id only).
const MAX_SNOOZE_MS = 2 * 366 * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "tasks/snooze", async () => {
      const body = (await req.json()) as { task_id?: unknown; until?: unknown; id?: unknown };
      const taskId = typeof body.task_id === "string" ? body.task_id : "";
      const id = clientRowId(body.id);
      if (!taskId && !id) return NextResponse.json({ error: "Missing task_id" }, { status: 400 });

      // Back now: the row goes.
      if (body.until === null || body.until === undefined) {
        let query = supabase.from("task_snoozes").delete().eq("user_id", profile.id);
        query = taskId ? query.eq("task_id", taskId) : query.eq("id", id as string);
        const { error } = await query;
        if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
        return NextResponse.json({ ok: true, snooze: null });
      }

      const until = typeof body.until === "string" ? new Date(body.until) : null;
      const now = Date.now();
      if (!until || Number.isNaN(until.getTime()) || until.getTime() <= now || until.getTime() > now + MAX_SNOOZE_MS) {
        return NextResponse.json({ error: "מועד החזרה לא תקין." }, { status: 400 });
      }
      const nowIso = new Date(now).toISOString();
      const fields = { until: until.toISOString(), notified_at: null, updated_at: nowIso };

      if (!taskId) {
        const { data, error } = await supabase
          .from("task_snoozes")
          .update(fields)
          .eq("id", id as string)
          .eq("user_id", profile.id)
          .select("id,task_id,until")
          .maybeSingle();
        if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
        if (!data) return NextResponse.json({ error: "הדחייה לא נמצאה." }, { status: 404 });
        return NextResponse.json({ ok: true, snooze: data });
      }

      // A new snooze, or a new time for this person's snooze of the task.
      const { data, error } = await supabase
        .from("task_snoozes")
        .upsert({ ...(id ? { id } : {}), task_id: taskId, user_id: profile.id, ...fields }, { onConflict: "task_id,user_id" })
        .select("id,task_id,until")
        .maybeSingle();
      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      return NextResponse.json({ ok: true, snooze: data });
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
