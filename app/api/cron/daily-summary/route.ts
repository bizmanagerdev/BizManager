import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverPush } from "@/lib/notifications/deliver";
import { sanitizeNotificationPrefs } from "@/lib/notifications/prefs";
import { getInboxView } from "@/lib/reminders/worklist";

// Reminders/Alerts redesign — Phase C: the per-user daily summary.
//
// Runs hourly and sends ONE push to each user whose chosen summary_hour is now:
//   "בוקר טוב — 5 משימות להיום, 2 תזכורות"  →  tap → /inbox
//
// This is the counterweight to owner-first + summary mode: automatic findings
// stop interrupting one-by-one, and instead arrive as a single daily digest.
// Users on delivery='all' are skipped — they already get every item live.

type Row = Record<string, unknown>;
const str = (row: Row, key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);

function israelHour(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(d);
  const h = parseInt(s, 10);
  return Number.isFinite(h) ? h % 24 : 8;
}

const TASK_RULES = new Set(["task_overdue", "task_due_soon"]);

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const hour = israelHour(new Date());

  const { data: users, error } = await supabase
    .from("users")
    .select("id,auth_user_id,role,active,full_name,notification_prefs")
    .eq("active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const due = ((users ?? []) as Row[])
    .map((u) => ({
      id: str(u, "id"),
      authId: str(u, "auth_user_id"),
      role: str(u, "role"),
      name: str(u, "full_name"),
      prefs: sanitizeNotificationPrefs((u as { notification_prefs?: unknown }).notification_prefs),
    }))
    .filter((u) => u.id && u.authId)
    // 'all' users already get every item as it happens — a digest would just double up.
    .filter((u) => u.prefs.delivery !== "all")
    .filter((u) => force || u.prefs.summary_hour === hour);

  if (due.length === 0) {
    return NextResponse.json({ ok: true, hour, skipped: true, reason: "no users due this hour" });
  }

  let sent = 0;
  let failed = 0;
  let skippedEmpty = 0;

  for (const u of due) {
    // Same read model as the inbox → the digest can never disagree with the page.
    const inbox = await getInboxView(supabase, { userId: u.id as string, role: u.role });
    const total = inbox.items.length + inbox.summaries.length;
    if (total === 0) {
      skippedEmpty += 1;
      continue; // nothing open → say nothing. Silence is a feature.
    }

    const tasks = inbox.items.filter((i) => TASK_RULES.has((i.dedupeKey ?? "").split(":")[0])).length;
    const mine = inbox.items.filter((i) => i.source === "manual").length;
    const other = inbox.items.length - tasks - mine;

    const parts: string[] = [];
    if (tasks > 0) parts.push(`${tasks} משימות`);
    if (mine > 0) parts.push(`${mine} תזכורות`);
    if (other > 0) parts.push(`${other} התראות`);
    if (inbox.summaries.length > 0) parts.push(`${inbox.summaries.length} סיכומים`);

    const greeting = hour < 12 ? "בוקר טוב" : hour < 18 ? "צהריים טובים" : "ערב טוב";
    const result = await deliverPush(
      supabase,
      [u.authId as string],
      {
        title: `${greeting}${u.name ? ` ${u.name.split(" ")[0]}` : ""} — ${total} ממתינים לטיפול`,
        body: parts.join(" · ") || "יש דברים שממתינים לך.",
        url: "/inbox",
        tag: "daily-summary",
      },
      "digests",
      // The digest IS the summary — it must land regardless of delivery mode.
      { alwaysPush: true }
    );
    sent += result.sent;
    failed += result.failed;
  }

  return NextResponse.json({ ok: true, hour, users: due.length, skippedEmpty, sent, failed });
}
