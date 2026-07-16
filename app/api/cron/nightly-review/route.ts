import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverPush } from "@/lib/notifications/deliver";
import { getNightlyConfig, recipientsForAudience } from "@/lib/notifications/alert-config";

// Nightly reminder (23:00–01:00 Israel): a DATA-CAPTURE nudge, not an alert.
// End of day → "these projects ran today, update what happened (tasks, money…)".
// Keeps pushing each run until someone marks the item בוצע.
//
// Population = projects ACTIVE that day, i.e. today falls inside the project's
// date range — NOT projects created today (which is what this used to count, and
// was backwards: a project opened three weeks ago but running today is exactly
// what needs an end-of-day update, while one merely *created* today may not have
// started). An open end_date counts as still ongoing.
//
// This is deliberately exempt from the owner-first delivery rules: it's an
// opted-in nightly ritual for the back office, so it pings regardless of each
// user's delivery mode.

function israelHour(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(d);
  const h = parseInt(s, 10);
  return Number.isFinite(h) ? h % 24 : 12;
}
function israelDate(d: Date): string {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });

  // On/off + window + audience come from the unified alert registry.
  const cfg = await getNightlyConfig(supabase);
  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: "disabled" });

  const now = new Date();
  const hour = israelHour(now);
  // Window may wrap past midnight (e.g. 23 → 1 means hours {23, 0}).
  const inWindow = cfg.startHour <= cfg.endHour ? hour >= cfg.startHour && hour < cfg.endHour : hour >= cfg.startHour || hour < cfg.endHour;
  // ?force=true lets an admin fire it any time (test button) — bypasses the window.
  const force = new URL(req.url).searchParams.get("force") === "true";
  if (!force && !inWindow) {
    return NextResponse.json({ ok: true, skipped: "outside-window", hour });
  }

  const date = israelDate(now);
  const nowIso = now.toISOString();

  // Active that day = scheduled to be running today. start_date has begun, and
  // the end_date hasn't passed (null end_date = ongoing).
  const { data: activeRows, error: activeError } = await supabase
    .from("projects")
    .select("id,name")
    .in("status", ["active", "in_progress"])
    .lte("start_date", date)
    .or(`end_date.gte.${date},end_date.is.null`)
    .range(0, 199);
  if (activeError) return NextResponse.json({ error: activeError.message }, { status: 500 });

  const projects = (activeRows ?? []) as Array<{ id?: string; name?: string }>;
  const projectCount = projects.length;
  if (projectCount === 0) {
    return NextResponse.json({ ok: true, skipped: "no-active-projects", date });
  }

  const dedupe = `nightly_review:${date}`;
  const names = projects
    .slice(0, 3)
    .map((p) => (typeof p.name === "string" && p.name ? p.name : "פרויקט"))
    .join(", ");
  const content =
    `${projectCount} פרויקטים פעילים היום — עדכן מה קרה: משימות, כסף, הוצאות.` +
    (names ? ` (${names}${projectCount > 3 ? " ועוד" : ""})` : "");

  // Existing reminder for tonight? If it's already resolved/done → user handled it, stop.
  const { data: existing } = await supabase
    .from("reminders")
    .select("id,status")
    .eq("dedupe_key", dedupe)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ex = existing as { id?: string; status?: string } | null;
  if (ex && ex.status !== "pending") {
    return NextResponse.json({ ok: true, acknowledged: true, date });
  }

  if (!ex) {
    await supabase.from("reminders").insert({
      source: "system",
      dedupe_key: dedupe,
      title: `🌙 ${projectCount} פרויקטים פעילים היום`,
      content,
      url: "/projects?status=active",
      severity: "warning",
      behavior: "ping_repeat",
      repeat_rule: "daily",
      category: "nightly_review",
      audience_role: cfg.audienceRole,
      status: "pending",
      remind_at: nowIso,
      action_type: null,
    });
  } else {
    // Keep the inbox copy's counts current.
    await supabase
      .from("reminders")
      .update({ title: `🌙 ${projectCount} פרויקטים פעילים היום`, content, updated_at: nowIso })
      .eq("id", ex.id);
  }

  // Push to the configured audience (this is a night-window alert by design).
  const authIds = await recipientsForAudience(supabase, cfg.audienceRole);

  let sent = 0;
  let failed = 0;
  if (authIds.length > 0) {
    const res = await deliverPush(
      supabase,
      authIds,
      {
        title: `🌙 ${projectCount} פרויקטים פעילים היום`,
        body: "עדכן מה קרה — משימות, כסף, הוצאות.",
        url: "/projects?status=active",
        tag: `nightly-review-${date}`,
      },
      "nightly",
      // The nightly ritual is opted-in by design — it isn't an automatic finding,
      // so it isn't subject to the per-user delivery mode.
      { alwaysPush: true }
    );
    sent = res.sent;
    failed = res.failed;
  }

  return NextResponse.json({ ok: true, date, projectCount, recipients: authIds.length, sent, failed });
}
