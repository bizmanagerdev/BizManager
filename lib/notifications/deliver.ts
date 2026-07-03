import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToRecipients, type PushPayload } from "@/lib/push";

// Per-recipient preference filtering: mute (bucket) → drop from BOTH in-app +
// push; push_paused → keep in-app, drop from push. Tolerant of the column not
// existing yet (pre-migration → everyone gets everything).
async function partitionByPrefs(
  supabase: SupabaseClient,
  authIds: string[],
  category: string
): Promise<{ inApp: string[]; push: string[] }> {
  try {
    const { data, error } = await supabase.from("users").select("auth_user_id,notification_prefs").in("auth_user_id", authIds);
    if (error || !data) return { inApp: authIds, push: authIds };
    const muted = new Set<string>();
    const paused = new Set<string>();
    for (const u of data as Array<{ auth_user_id?: string | null; notification_prefs?: { muted?: unknown; push_paused?: unknown } | null }>) {
      const uid = u.auth_user_id;
      if (!uid) continue;
      const p = u.notification_prefs;
      if (p && Array.isArray(p.muted) && (p.muted as unknown[]).includes(category)) muted.add(uid);
      if (p && p.push_paused === true) paused.add(uid);
    }
    const inApp = authIds.filter((id) => !muted.has(id));
    const push = inApp.filter((id) => !paused.has(id));
    return { inApp, push };
  } catch {
    return { inApp: authIds, push: authIds };
  }
}

// One place that both RECORDS an in-app notification (for the bell's read/unread
// history) and sends the push, honoring each recipient's mute/pause prefs.
// Callers pass AUTH uids + a mute bucket (see lib/notifications/categories.ts).
export async function deliverPush(
  supabase: SupabaseClient,
  authIds: string[],
  payload: PushPayload,
  category: string
): Promise<{ sent: number; failed: number }> {
  const ids = [...new Set(authIds)].filter(Boolean);
  if (ids.length === 0) return { sent: 0, failed: 0 };

  const { inApp, push } = await partitionByPrefs(supabase, ids, category);

  if (inApp.length > 0) {
    try {
      await supabase.from("notifications").insert(
        inApp.map((uid) => ({
          user_id: uid,
          title: payload.title,
          body: payload.body ?? "",
          url: payload.url ?? "/alerts",
          category,
          tag: payload.tag ?? null,
        }))
      );
    } catch {
      // notifications table may not exist yet (pre-migration) — never block the push
    }
  }

  if (push.length === 0) return { sent: 0, failed: 0 };
  return sendPushToRecipients(supabase, push, payload);
}
