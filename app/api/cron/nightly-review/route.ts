import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToRecipients } from "@/lib/push";
import { getNightlyConfig, recipientsForAudience } from "@/lib/notifications/alert-config";

// Nightly reminder (23:00–01:00 Israel) to review + update today's new orders
// (הובלות) and projects. Keeps pushing to admin+office each run until someone
// marks the worklist item בוצע. Hit on a short schedule during the night window
// with the CRON_SECRET bearer token.

function israelHour(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(d);
  const h = parseInt(s, 10);
  return Number.isFinite(h) ? h % 24 : 12;
}
function israelDate(d: Date): string {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
// The UTC instant that is 00:00 in Israel for today's Israel date (DST-safe).
function israelDayStartIso(d: Date): string {
  const [y, m, day] = israelDate(d).split("-").map(Number);
  for (const off of [2, 3]) {
    const cand = new Date(Date.UTC(y, m - 1, day, 0 - off, 0, 0));
    if (israelHour(cand) === 0) return cand.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, day, -2, 0, 0)).toISOString();
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
  const dayStart = israelDayStartIso(now);
  const nowIso = now.toISOString();

  const [ordersRes, projectsRes] = await Promise.all([
    supabase.from("orders").select("id", { count: "estimated", head: true }).gte("created_at", dayStart),
    supabase.from("projects").select("id", { count: "estimated", head: true }).gte("created_at", dayStart),
  ]);
  const orderCount = typeof ordersRes.count === "number" ? ordersRes.count : 0;
  const projectCount = typeof projectsRes.count === "number" ? projectsRes.count : 0;
  if (orderCount + projectCount === 0) {
    return NextResponse.json({ ok: true, skipped: "nothing-new", date });
  }

  const dedupe = `nightly_review:${date}`;
  const content = `${orderCount} הובלות ו-${projectCount} פרויקטים נוספו היום — יש לעדכן ולסמן בוצע.`;

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
      title: "🌙 עדכון הובלות ופרויקטים מהיום",
      content,
      url: "/sales",
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
    // Keep the worklist copy's counts current.
    await supabase.from("reminders").update({ content, updated_at: nowIso }).eq("id", ex.id);
  }

  // Push to the configured audience (this is a night-window alert by design).
  const authIds = await recipientsForAudience(supabase, cfg.audienceRole);

  let sent = 0;
  let failed = 0;
  if (authIds.length > 0) {
    const res = await sendPushToRecipients(supabase, authIds, {
      title: "🌙 עדכון הובלות ופרויקטים",
      body: content,
      url: "/sales",
      tag: `nightly-review-${date}`,
    });
    sent = res.sent;
    failed = res.failed;
  }

  return NextResponse.json({ ok: true, date, orderCount, projectCount, recipients: authIds.length, sent, failed });
}
