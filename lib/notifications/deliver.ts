import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToRecipients, type PushPayload } from "@/lib/push";
import { sanitizeNotificationPrefs, shouldPushNow } from "@/lib/notifications/prefs";

export type DeliverOptions = {
  /** Item severity — decides whether 'summary_urgent' users get interrupted. */
  severity?: string;
  /**
   * Bypass the delivery-mode gate. TRUE for a reminder a human set with a time:
   * "remind me at 14:00" must ping at 14:00 in EVERY mode — that's the contract.
   * Mute + push_paused are still honored (those are explicit "no").
   */
  alwaysPush?: boolean;
};

// Per-recipient preference filtering:
//   muted bucket  → drop from BOTH in-app and push
//   push_paused   → keep in-app, drop from push
//   delivery mode → keep in-app; push only if this item earns an interrupt now
//                   (summary → never; summary_urgent → danger only; all → always)
// Tolerant of the column not existing yet (pre-migration → everyone gets everything).
async function partitionByPrefs(
  supabase: SupabaseClient,
  authIds: string[],
  category: string,
  opts: DeliverOptions
): Promise<{ inApp: string[]; push: string[] }> {
  try {
    const { data, error } = await supabase.from("users").select("auth_user_id,notification_prefs").in("auth_user_id", authIds);
    if (error || !data) return { inApp: authIds, push: authIds };
    const muted = new Set<string>();
    const noPush = new Set<string>();
    for (const u of data as Array<{ auth_user_id?: string | null; notification_prefs?: unknown }>) {
      const uid = u.auth_user_id;
      if (!uid) continue;
      const prefs = sanitizeNotificationPrefs(u.notification_prefs);
      if (prefs.muted.includes(category)) muted.add(uid);
      // A human-set timed reminder ignores the delivery mode, but never ignores
      // an explicit push_paused.
      const allowed = opts.alwaysPush ? !prefs.push_paused : shouldPushNow(prefs, opts.severity ?? "info");
      if (!allowed) noPush.add(uid);
    }
    const inApp = authIds.filter((id) => !muted.has(id));
    const push = inApp.filter((id) => !noPush.has(id));
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
  category: string,
  opts: DeliverOptions = {}
): Promise<{ sent: number; failed: number }> {
  const ids = [...new Set(authIds)].filter(Boolean);
  if (ids.length === 0) return { sent: 0, failed: 0 };

  const { inApp, push } = await partitionByPrefs(supabase, ids, category, opts);

  if (inApp.length > 0) {
    try {
      await supabase.from("notifications").insert(
        inApp.map((uid) => ({
          user_id: uid,
          title: payload.title,
          body: payload.body ?? "",
          url: payload.url ?? "/inbox",
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
