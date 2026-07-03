import type { SupabaseClient } from "@supabase/supabase-js";

// THE single place that bridges the two id spaces: app rows (reminders,
// tasks, config) use `users.id`, but push_subscriptions + notifications are
// keyed by the AUTH uid (users.auth_user_id). Always map through here.

/** users.id[] → their auth_user_id[] (deduped, nulls dropped). */
export async function usersToAuthIds(supabase: SupabaseClient, userIds: string[]): Promise<string[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const { data } = await supabase.from("users").select("auth_user_id").in("id", ids);
  return ((data ?? []) as Array<{ auth_user_id?: string | null }>)
    .map((u) => u.auth_user_id)
    .filter((v): v is string => Boolean(v));
}

/** users.id → auth_user_id map (for keeping per-row associations). */
export async function usersToAuthMap(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return map;
  const { data } = await supabase.from("users").select("id,auth_user_id").in("id", ids);
  for (const u of (data ?? []) as Array<{ id?: string | null; auth_user_id?: string | null }>) {
    if (u.id && u.auth_user_id) map.set(u.id, u.auth_user_id);
  }
  return map;
}
