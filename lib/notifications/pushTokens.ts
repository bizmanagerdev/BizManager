import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Direct-to-Supabase writes for fcm_tokens/push_subscriptions. Both tables'
 * RLS is a clean self-only policy (auth.uid() = user_id — see
 * lib/notifications/identity.ts), so these need the real auth uid, NOT
 * users.id/profile.id (see the 2026-09-01 fix note in the old API routes'
 * git history — that mismatch used to make every write here fail silently
 * for admin-created accounts). Mirrors the now-deleted
 * /api/notifications/{fcm-register,fcm-unregister,subscribe,unsubscribe} routes,
 * which used the same RLS-bound client with no other logic on top.
 */

async function currentAuthUserId(): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * The user agent kept with a phone's token, plus "BizHApp/<build>" inside the
 * phone app: the server reads the build to know which alerts the phone can show
 * (lib/fcm.ts — task alerts with buttons need APK 1.2, build 6). A phone app
 * without the App helper (1.0.x) says nothing and keeps the plain alerts.
 */
async function deviceUserAgent(): Promise<string | null> {
  if (typeof navigator === "undefined") return null;
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("App")) {
      const { App } = await import("@capacitor/app");
      const { build } = await App.getInfo();
      if (build) return `${navigator.userAgent} BizHApp/${build}`;
    }
  } catch {
    // Not inside the phone app.
  }
  return navigator.userAgent;
}

/** Returns the failure reason too — `registerFcmToken` used to collapse a
 *  real Postgres/RLS error into a bare `false`, so the one Sentry event this
 *  ever produced ("fcm token registration failed") never said WHY. Confirmed
 *  live 2026-09-14: one device failing on every launch for two weeks with
 *  nothing to actually diagnose it by. */
export async function registerFcmToken(
  token: string,
  platform: string
): Promise<{ ok: boolean; errorMessage?: string }> {
  const userId = await currentAuthUserId();
  if (!userId) return { ok: false, errorMessage: "no auth user id" };
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("fcm_tokens").upsert(
    {
      user_id: userId,
      token,
      platform,
      user_agent: await deviceUserAgent(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" }
  );
  return error ? { ok: false, errorMessage: error.message } : { ok: true };
}

export async function unregisterFcmToken(token?: string): Promise<void> {
  const userId = await currentAuthUserId();
  if (!userId) return;
  const supabase = createSupabaseBrowserClient();
  let query = supabase.from("fcm_tokens").delete().eq("user_id", userId);
  if (token) query = query.eq("token", token);
  await query;
}

export async function subscribeWebPush(endpoint: string, p256dh: string, auth: string): Promise<boolean> {
  const userId = await currentAuthUserId();
  if (!userId) return false;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: typeof navigator === "undefined" ? null : navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" }
  );
  return !error;
}

export async function unsubscribeWebPush(endpoint?: string): Promise<void> {
  const userId = await currentAuthUserId();
  if (!userId) return;
  const supabase = createSupabaseBrowserClient();
  let query = supabase.from("push_subscriptions").delete().eq("user_id", userId);
  if (endpoint) query = query.eq("endpoint", endpoint);
  await query;
}
