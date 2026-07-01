import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { sendPushToAll } from "@/lib/push";

// Admin-only manual trigger. Sends a single guaranteed, visible test
// notification to every subscribed device so the full push pipeline
// (subscription → VAPID → service worker → display) can be verified on a
// real phone. Unlike the scheduled cron, this does NOT depend on any alert
// being due this hour or on there being real data to report.
export async function POST() {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const by = profile.full_name?.trim() || profile.email || "מנהל";

  // Unique tag per send so each test is a fresh notification that re-alerts,
  // instead of Android silently coalescing it into the previous test.
  const result = await sendPushToAll(supabase, {
    title: "✅ בדיקת התראות",
    body: `זוהי התראת בדיקה שנשלחה על ידי ${by}. אם קיבלת אותה — ההתראות עובדות!`,
    url: "/alerts",
    tag: `bizh-test-${Date.now()}`,
  });

  return NextResponse.json({ ok: true, ...result });
}
