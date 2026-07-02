import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser, sendPushToRecipients, type PushPayload } from "@/lib/push";
import { visibleAudienceRoles } from "@/lib/reminders/worklist";

// Reminders/Alerts unification — Phase 3: the deliver cron (every ~5 min).
// Pushes due reminders — manual ones AND system issue reminders — honoring
// snooze, quiet hours, ping-once vs ping-repeat cadence.
//
// Identity note: reminders.assigned_to / created_by hold `users.id`, but push
// subscriptions are keyed by the AUTH user id (users.auth_user_id). We resolve
// users.id -> auth_user_id before sending. (The old cron pushed to users.id
// directly, so task-reminder pushes silently missed — fixed here.)

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}
function num(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// Current hour (0–23) in Israel, DST-safe via Intl.
function israelHour(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(d);
  const h = parseInt(s, 10);
  return Number.isFinite(h) ? h % 24 : 9;
}
// Next time it's 08:00 in Israel, as an ISO string (used to defer night pings).
function nextMorningIso(now: Date): string {
  for (let i = 1; i <= 48; i++) {
    const c = new Date(now.getTime() + i * 3_600_000);
    if (israelHour(c) === 8) return c.toISOString();
  }
  return new Date(now.getTime() + 3_600_000).toISOString();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  // ?force=true lets an admin test-send any time (bypasses the 08:00–21:00 window).
  const force = new URL(req.url).searchParams.get("force") === "true";
  const inWindow = force || (() => {
    const h = israelHour(now);
    return h >= 8 && h < 21;
  })();

  const { data, error } = await supabase
    .from("reminders")
    .select(
      "id,source,behavior,repeat_rule,max_pings,ping_count,next_ping_at,remind_at,snoozed_until,category," +
        "assigned_to,audience_role,created_by,title,content,url,task_id"
    )
    .eq("status", "pending")
    .is("notified_at", null)
    .order("remind_at", { ascending: true })
    .range(0, 499);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data ?? []) as unknown as Row[]).filter((r) => {
    const snoozed = str(r, "snoozed_until");
    if (!snoozed) return true;
    const t = new Date(snoozed).getTime();
    return Number.isNaN(t) || t <= nowMs;
  });

  type Send = { row: Row; finalize: "notify" | "repeat" };
  const toSend: Send[] = [];
  const defers: Array<{ id: string; next_ping_at: string }> = [];

  for (const row of rows) {
    const id = str(row, "id");
    if (!id) continue;
    const source = str(row, "source") ?? "manual";

    if (source === "system") {
      const behavior = str(row, "behavior") ?? "ping_once";
      if (behavior === "silent") continue; // list-only, never pushes
      // The nightly-review reminder is delivered by its own night-window cron
      // (23:00–01:00), so this day cron must not push it during quiet hours.
      if (str(row, "category") === "nightly_review") continue;
      const next = str(row, "next_ping_at");
      const due = !next || new Date(next).getTime() <= nowMs;
      if (!due) continue;
      if (!inWindow) {
        defers.push({ id, next_ping_at: nextMorningIso(now) });
        continue;
      }
      toSend.push({ row, finalize: behavior === "ping_repeat" ? "repeat" : "notify" });
    } else {
      // Manual / legacy reminder: due at remind_at, pushed once.
      const remindAt = str(row, "remind_at");
      const due = remindAt ? new Date(remindAt).getTime() <= nowMs : false;
      if (!due) continue;
      if (!inWindow) continue; // retried next run once we're back in the window
      toSend.push({ row, finalize: "notify" });
    }
  }

  // Resolve recipients: users.id -> auth_user_id, and role buckets -> auth ids.
  const userIds = new Set<string>();
  const roles = new Set<string>();
  for (const { row } of toSend) {
    const assigned = str(row, "assigned_to") ?? str(row, "created_by");
    if (assigned) userIds.add(assigned);
    else {
      const ar = str(row, "audience_role");
      if (ar) roles.add(ar);
    }
  }

  const authByUser = new Map<string, string>();
  if (userIds.size) {
    const { data: us } = await supabase.from("users").select("id,auth_user_id").in("id", [...userIds]);
    for (const u of (us ?? []) as unknown as Row[]) {
      const uid = str(u, "id");
      const aid = str(u, "auth_user_id");
      if (uid && aid) authByUser.set(uid, aid);
    }
  }

  // For each needed role bucket, the auth ids of active users in it.
  const authByRole = new Map<string, string[]>();
  if (roles.size) {
    const { data: us } = await supabase.from("users").select("id,auth_user_id,role,active").eq("active", true);
    const all = (us ?? []) as unknown as Row[];
    for (const ar of roles) {
      // A user of role R receives bucket B when B ∈ visibleAudienceRoles(R):
      // so 'office' reaches office + admin, 'admin' reaches admin only, 'all' everyone.
      const ids = all
        .filter((u) => {
          if (ar === "all") return true;
          const role = str(u, "role");
          return role ? visibleAudienceRoles(role).includes(ar) : false;
        })
        .map((u) => str(u, "auth_user_id"))
        .filter((v): v is string => Boolean(v));
      authByRole.set(ar, ids);
    }
  }

  // Task subjects for manual reminders lacking a title.
  const taskIds = [
    ...new Set(
      toSend
        .filter(({ row }) => !str(row, "title") && str(row, "task_id"))
        .map(({ row }) => str(row, "task_id") as string)
    ),
  ];
  const subjectByTask = new Map<string, string>();
  if (taskIds.length) {
    const { data: tasks } = await supabase.from("tasks").select("id,subject").in("id", taskIds);
    for (const t of (tasks ?? []) as unknown as Row[]) {
      const tid = str(t, "id");
      if (tid) subjectByTask.set(tid, str(t, "subject") ?? "משימה");
    }
  }

  let sent = 0;
  let failed = 0;
  const notifyIds: string[] = [];
  const repeatUpdates: Array<{ id: string; next_ping_at: string; ping_count: number }> = [];

  await Promise.all(
    toSend.map(async ({ row, finalize }) => {
      const id = str(row, "id") as string;
      const taskId = str(row, "task_id");
      const titleRaw = str(row, "title");
      const subject = taskId ? subjectByTask.get(taskId) ?? null : null;
      const title = titleRaw ?? (subject ? `🔔 תזכורת: ${subject}` : "🔔 תזכורת");
      const body = str(row, "content") ?? (subject ? "הגיע מועד התזכורת למשימה." : "הגיע מועד התזכורת.");
      const url = str(row, "url") ?? (taskId ? `/tasks/${taskId}` : "/tasks");
      const payload: PushPayload = { title, body, url, tag: `reminder-${id}` };

      const assigned = str(row, "assigned_to") ?? str(row, "created_by");
      let result = { sent: 0, failed: 0 };
      if (assigned) {
        const authId = authByUser.get(assigned);
        if (authId) result = await sendPushToUser(supabase, authId, payload);
      } else {
        const ar = str(row, "audience_role");
        const ids = ar ? authByRole.get(ar) ?? [] : [];
        if (ids.length) result = await sendPushToRecipients(supabase, ids, payload);
      }
      sent += result.sent;
      failed += result.failed;

      // Finalize state regardless of send success (avoid infinite ret/re-push).
      if (finalize === "repeat") {
        const count = num(row, "ping_count") + 1;
        const max = str(row, "max_pings") ? num(row, "max_pings") : null;
        if (max !== null && count >= max) {
          notifyIds.push(id); // reached the cap → stop pinging
        } else {
          repeatUpdates.push({ id, next_ping_at: nextMorningIso(now), ping_count: count });
        }
      } else {
        notifyIds.push(id);
      }
    })
  );

  // Apply state transitions.
  if (notifyIds.length) {
    await supabase.from("reminders").update({ notified_at: nowIso, next_ping_at: null }).in("id", notifyIds);
  }
  await Promise.all(
    repeatUpdates.map((u) =>
      supabase.from("reminders").update({ next_ping_at: u.next_ping_at, ping_count: u.ping_count }).eq("id", u.id)
    )
  );
  await Promise.all(
    defers.map((d) => supabase.from("reminders").update({ next_ping_at: d.next_ping_at }).eq("id", d.id))
  );

  return NextResponse.json({
    ok: true,
    inWindow,
    considered: rows.length,
    pushed: toSend.length,
    deferred: defers.length,
    sent,
    failed,
  });
}
