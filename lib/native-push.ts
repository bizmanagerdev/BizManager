// Shared native-FCM helpers used by both the auto-registration component
// (NativePushRegistration) and the manual "enable notifications" button
// (PushSubscribeButton). Kept in one place so the channel definition, the
// permission flow, and the token-upload contract never drift apart.
//
// All Capacitor packages are pulled in with dynamic import() so nothing here is
// bundled into the server build or evaluated during SSR.

export type NativeEnableResult = "granted" | "denied" | "unsupported";

let listenersAttached = false;

// True only inside the real Capacitor shell (the APK). False in every browser,
// including an installed browser PWA.
export async function isNativePlatform(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// Current native notification permission, without prompting. Used by the UI to
// decide whether to show "enable" vs "on" vs a blocked hint.
export async function nativePermissionStatus(): Promise<
  "granted" | "denied" | "prompt" | "unsupported"
> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return "unsupported";
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === "granted") return "granted";
    if (perm.receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

// Turn off native notifications for this user's devices: drop the server-side
// tokens so no more FCM is sent. (The OS-level permission stays granted; the
// user can re-enable instantly.)
export async function disableNativePush(): Promise<void> {
  await fetch("/api/notifications/fcm-unregister", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).catch(() => {});
}

// Create the channel, request permission, register with FCM, and start
// forwarding the token + notification taps to the app. Idempotent: safe to call
// on every app load AND from a button tap — listeners attach at most once, and
// register() just re-upserts the same token.
export async function enableNativePush(): Promise<NativeEnableResult> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return "unsupported";

    const { PushNotifications } = await import("@capacitor/push-notifications");

    // HIGH-importance channel (importance 5 = IMPORTANCE_HIGH) → heads-up banner.
    // Our code owns this channel, so Samsung can't silently downgrade it the way
    // it does with Chrome's web-push channel.
    await PushNotifications.createChannel({
      id: "bizh_alerts",
      name: "התראות BizH",
      description: "התראות עסקיות מ-BizManager",
      importance: 5,
      visibility: 1,
      vibration: true,
    }).catch(() => {});

    if (!listenersAttached) {
      listenersAttached = true;

      await PushNotifications.addListener("registration", (token) => {
        void fetch("/api/notifications/fcm-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.value, platform: Capacitor.getPlatform() }),
        }).catch(() => {});
      });

      // Tapping a notification deep-links to the alert it was about.
      await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const url = (action.notification.data as { url?: string } | undefined)?.url;
        if (!url) return;
        window.location.href = url.startsWith("http") ? url : window.location.origin + url;
      });
    }

    // Android 13+ runtime permission.
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return "denied";

    await PushNotifications.register();
    return "granted";
  } catch {
    return "unsupported";
  }
}
