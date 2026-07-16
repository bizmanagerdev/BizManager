import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushPayload } from "@/lib/push";
// Type-only imports are erased at build time, so firebase-admin is still loaded
// lazily at runtime (see getMessaging) — these just give us precise types.
import type { ServiceAccount } from "firebase-admin/app";
import type { MulticastMessage } from "firebase-admin/messaging";

// ── Firebase Admin, lazily initialised ───────────────────────────────────────
// Native Android (the Capacitor APK) cannot receive web push — the WebView has
// no Push API. Instead it registers an FCM token (stored in fcm_tokens) and we
// deliver here via firebase-admin. This runs ONLY on the Node.js server runtime.
//
// Credentials come from a single env var FIREBASE_SERVICE_ACCOUNT_JSON holding
// the service-account JSON downloaded from the Firebase console (Project
// settings → Service accounts → Generate new private key). Paste it verbatim;
// JSON.parse turns the escaped "\n" in private_key back into real newlines.

type Messaging = Awaited<
  ReturnType<typeof import("firebase-admin/messaging")["getMessaging"]>
>;

let messagingSingleton: Messaging | null | undefined;

async function getMessaging(): Promise<Messaging | null> {
  // undefined = not yet tried; null = tried and unavailable (don't retry).
  if (messagingSingleton !== undefined) return messagingSingleton;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    messagingSingleton = null;
    return null;
  }

  try {
    // Modular subpath imports have precise types (unlike the CJS root namespace).
    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    const { getMessaging: getFcm } = await import("firebase-admin/messaging");

    // The downloaded service-account JSON (snake_case) is accepted by cert().
    const serviceAccount = JSON.parse(raw) as ServiceAccount;

    // Reuse an existing app across warm serverless invocations instead of
    // throwing "app already exists".
    const app = getApps().length
      ? getApps()[0]!
      : initializeApp({ credential: cert(serviceAccount) });

    messagingSingleton = getFcm(app);
    return messagingSingleton;
  } catch {
    messagingSingleton = null;
    return null;
  }
}

type TokenRow = { id: string; token: string; user_id: string };

// Send a payload to a specific list of user IDs' native devices. Mirrors the
// web-push sendPushToRecipients contract: returns { sent, failed } and prunes
// tokens FCM reports as permanently invalid.
export async function sendFcmToRecipients(
  supabase: SupabaseClient,
  recipientUserIds: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const messaging = await getMessaging();
  if (!messaging) return { sent: 0, failed: 0 };

  let query = supabase.from("fcm_tokens").select("id,token,user_id");
  // Empty recipient list means "everyone" (matches sendPushToRecipients).
  if (recipientUserIds.length > 0) query = query.in("user_id", recipientUserIds);

  const { data: rows, error } = await query;
  if (error || !rows?.length) return { sent: 0, failed: 0 };

  const tokens = (rows as TokenRow[]).map((r) => r.token);

  const message: MulticastMessage = {
    tokens,
    notification: { title: payload.title, body: payload.body ?? "" },
    android: {
      // High-priority FCM delivery wakes the device immediately.
      priority: "high",
      notification: {
        // Our app-created HIGH-importance channel → guaranteed heads-up banner.
        channelId: "bizh_alerts",
        defaultSound: true,
        defaultVibrateTimings: true,
        // Same tag → the OS replaces an older alert of the same kind.
        tag: payload.tag,
      },
    },
    // Carried through to the tap handler (NativePushRegistration) for deep-link.
    data: { url: payload.url ?? "/inbox" },
  };

  let res;
  try {
    res = await messaging.sendEachForMulticast(message);
  } catch {
    return { sent: 0, failed: tokens.length };
  }

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  res.responses.forEach((r, i) => {
    if (r.success) {
      sent++;
      return;
    }
    failed++;
    const code = r.error?.code;
    // These mean the token is permanently dead — uninstalled, or refreshed.
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      staleIds.push((rows as TokenRow[])[i].id);
    }
  });

  if (staleIds.length > 0) {
    await supabase.from("fcm_tokens").delete().in("id", staleIds);
  }

  return { sent, failed };
}
