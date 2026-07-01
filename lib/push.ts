import webpush from "web-push";
// SupabaseClient here is intentionally wide — both anon (route handlers) and
// service-role (cron jobs) clients satisfy this interface.
import type { SupabaseClient } from "@supabase/supabase-js";

let vapidConfigured = false;

function ensureVapidConfigured() {
  if (vapidConfigured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@bizmanager.app",
    publicKey,
    privateKey
  );
  vapidConfigured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
};

export async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,user_id")
    .eq("user_id", userId);

  if (error || !rows?.length) return { sent: 0, failed: 0 };
  return sendToRows(supabase, rows as SubscriptionRow[], payload);
}

export async function sendPushToAll(
  supabase: SupabaseClient,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,user_id");

  if (error || !rows?.length) return { sent: 0, failed: 0 };
  return sendToRows(supabase, rows as SubscriptionRow[], payload);
}

// Send to a specific list of user IDs; if list is empty, sends to all.
export async function sendPushToRecipients(
  supabase: SupabaseClient,
  recipientUserIds: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (recipientUserIds.length === 0) {
    return sendPushToAll(supabase, payload);
  }
  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,user_id")
    .in("user_id", recipientUserIds);

  if (error || !rows?.length) return { sent: 0, failed: 0 };
  return sendToRows(supabase, rows as SubscriptionRow[], payload);
}

async function sendToRows(
  supabase: SupabaseClient,
  rows: SubscriptionRow[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!ensureVapidConfigured()) {
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const expiredIds: string[] = [];

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
          // High urgency → the push service (FCM) delivers as a high-priority
          // message, which wakes the device immediately and makes Android more
          // willing to show a heads-up banner rather than a silent tray entry.
          { urgency: "high" }
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 410 || status === 404) {
          expiredIds.push(row.id);
        }
      }
    })
  );

  if (expiredIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expiredIds);
  }

  return { sent, failed };
}
