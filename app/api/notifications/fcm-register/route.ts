import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Native (Capacitor APK) devices register their Firebase Cloud Messaging token
// here. Mirrors /subscribe (web push) but for the native FCM path — the WebView
// cannot use web push, so the APK sends its FCM token instead. See lib/fcm.ts.
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const body = (await req.json()) as { token?: string; platform?: string };

  if (!body.token) {
    return NextResponse.json({ error: "Missing FCM token" }, { status: 400 });
  }

  // Upsert on token: a token is unique to one device install. Re-registering
  // (new login on the same phone, token refresh) moves it to the current user
  // and refreshes last_seen_at instead of creating a duplicate row.
  const { error } = await supabase.from("fcm_tokens").upsert(
    {
      user_id: profile.id,
      token: body.token,
      platform: body.platform ?? "android",
      user_agent: req.headers.get("user-agent"),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" }
  );

  if (error) {
    return NextResponse.json({ error: toHebrewError(error.message) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
