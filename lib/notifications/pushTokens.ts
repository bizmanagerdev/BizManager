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

export async function registerFcmToken(token: string, platform: string): Promise<boolean> {
  const userId = await currentAuthUserId();
  if (!userId) return false;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("fcm_tokens").upsert(
    {
      user_id: userId,
      token,
      platform,
      user_agent: typeof navigator === "undefined" ? null : navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" }
  );
  return !error;
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
