import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const v = row[key];
  return typeof v === "string" ? v : null;
}

// Fires due reminders as web-push. Hit this on a schedule (e.g. every few minutes)
// from a cron runner with the CRON_SECRET bearer token. Requires
// SUPABASE_SERVICE_ROLE_KEY + VAPID keys to be configured to actually deliver.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  const nowIso = new Date().toISOString();

  const { data: dueRows, error } = await supabase
    .from("reminders")
    .select("id,task_id,content,action_type,assigned_to,created_by,remind_at,customer_id,category")
    .eq("status", "pending")
    .is("notified_at", null)
    .lte("remind_at", nowIso)
    .order("remind_at", { ascending: true })
    .range(0, 199);

  if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 500 });

  const reminders = (dueRows ?? []) as Row[];
  if (reminders.length === 0) {
    return NextResponse.json({ ok: true, due: 0, sent: 0 });
  }

  // Resolve task subjects so the push body is meaningful.
  const taskIds = [
    ...new Set(reminders.map((r) => getString(r, "task_id")).filter((v): v is string => Boolean(v))),
  ];
  const subjectByTask = new Map<string, string>();
  if (taskIds.length > 0) {
    const { data: tasks } = await supabase.from("tasks").select("id,subject").in("id", taskIds);
    for (const t of (tasks ?? []) as Row[]) {
      const id = getString(t, "id");
      if (id) subjectByTask.set(id, getString(t, "subject") ?? "משימה");
    }
  }

  let sent = 0;
  let failed = 0;
  const notifiedIds: string[] = [];

  await Promise.all(
    reminders.map(async (reminder) => {
      const id = getString(reminder, "id");
      if (!id) return;
      const recipient = getString(reminder, "assigned_to") ?? getString(reminder, "created_by");
      // Always mark notified so we don't keep retrying a reminder with no recipient.
      notifiedIds.push(id);
      if (!recipient) return;

      const taskId = getString(reminder, "task_id");
      const subject = taskId ? subjectByTask.get(taskId) ?? "משימה" : null;
      const note = getString(reminder, "content");
      const title = subject ? `🔔 תזכורת: ${subject}` : "🔔 תזכורת";
      const body = note ?? (subject ? "הגיע מועד התזכורת למשימה." : "הגיע מועד התזכורת.");
      const url = taskId ? `/tasks/${taskId}` : "/tasks";

      const result = await sendPushToUser(supabase, recipient, { title, body, url, tag: `reminder-${id}` });
      sent += result.sent;
      failed += result.failed;
    })
  );

  if (notifiedIds.length > 0) {
    await supabase.from("reminders").update({ notified_at: nowIso }).in("id", notifiedIds);
  }

  return NextResponse.json({ ok: true, due: reminders.length, sent, failed });
}
