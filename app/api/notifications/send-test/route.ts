import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToAll, sendPushToUser } from "@/lib/push";

// Admin-only manual trigger. Sends a single guaranteed, visible test
// notification so the full push pipeline (subscription → VAPID → service worker
// → display) can be verified on a real phone. Unlike the scheduled cron, this
// does NOT depend on any alert being due or on there being real data to report.
//
// IMPORTANT: the send MUST run through the service-role client. The RLS policy
// on push_subscriptions is `auth.uid() = user_id`, so an admin's own (RLS-bound)
// client can only see the admin's OWN devices — a test sent that way would never
// reach any other user, no matter how many devices they have connected.
//
// Optional body { userId } targets one specific user's devices (used by the
// "send test" button next to each user in Settings → connected devices).
export async function POST(req: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { profile } = access.value;

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  let userId: string | null = null;
  try {
    const body = (await req.json()) as { userId?: string };
    userId = typeof body?.userId === "string" && body.userId ? body.userId : null;
  } catch {
    // No body — send to everyone.
  }

  const by = profile.full_name?.trim() || profile.email || "מנהל";

  const payload = {
    title: "✅ בדיקת התראות",
    body: `זוהי התראת בדיקה שנשלחה על ידי ${by}. אם קיבלת אותה — ההתראות עובדות!`,
    url: "/inbox",
    // Unique tag per send so each test is a fresh notification that re-alerts,
    // instead of Android silently coalescing it into the previous test.
    tag: `bizh-test-${Date.now()}`,
  };

  const result = userId
    ? await sendPushToUser(admin, userId, payload)
    : await sendPushToAll(admin, payload);

  return NextResponse.json({ ok: true, ...result });
}
