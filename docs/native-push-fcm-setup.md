# Native push (Android APK / FCM) — setup & how it works

The browser PWA uses **Web Push** (VAPID + service worker). The Android System
WebView inside the Capacitor APK has **no Web Push API**, so the APK can never
receive those. Native builds instead register with **Firebase Cloud Messaging
(FCM)** and the server sends to them via `firebase-admin`. Every alert now goes
out over **both** channels, so browser PWAs and the APK both get it.

Native notifications are shown on an app-created **HIGH-importance channel**
(`bizh_alerts`), which is what guarantees the heads-up (pop-up) banner on Samsung
— our code owns the channel, so nothing can silently downgrade it the way it does
with Chrome's web-push channel.

## What's already in the code

- `@capacitor/push-notifications` installed + `npx cap sync` done.
- `android/.../AndroidManifest.xml`: `POST_NOTIFICATIONS` permission + FCM default
  channel meta-data (`bizh_alerts`).
- `lib/native-push.ts`: creates the channel, requests permission, registers,
  uploads the token, handles notification taps.
- `components/pwa/NativePushRegistration.tsx`: runs the above on app launch
  (no-op in a browser). Mounted in `app/layout.tsx`.
- `PushSubscribeButton` now handles native (FCM) as well as web push.
- `app/api/notifications/fcm-register` + `fcm-unregister`: store/remove tokens.
- `supabase/migrations/20260715000000_fcm_tokens.sql`: the `fcm_tokens` table.
- `lib/fcm.ts`: server send path, wired into `sendPushToUser/All/Recipients` in
  `lib/push.ts`, so `deliverPush` and the "send test" button both reach native.

## What YOU need to do (one-time)

### 1. Create the Firebase project (~5 min)

1. Go to <https://console.firebase.google.com> → **Add project** → name it
   (e.g. `bizh`). Google Analytics is optional; skip it.
2. In the project, click the **Android** icon ("Add app").
   - **Android package name:** `com.bizh.app`  ← must match exactly.
   - Nickname / debug SHA-1: leave blank.
   - Click **Register app**.
3. **Download `google-services.json`** and place it at:
   ```
   bizmanager/android/app/google-services.json
   ```
   (The Gradle build auto-detects it — see `android/app/build.gradle`.)
4. Skip the remaining "add SDK" steps in the wizard — Capacitor already did that.

### 2. Get the server credentials

1. Firebase console → ⚙ **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → confirm → a JSON file downloads.
3. In **Vercel → Project → Settings → Environment Variables**, add:
   - **Name:** `FIREBASE_SERVICE_ACCOUNT_JSON`
   - **Value:** paste the **entire contents** of that JSON file (one blob,
     including the `\n`-escaped private key — paste it verbatim).
   - Apply to **Production** (and Preview if you test there).
4. Redeploy so the new env var is picked up.

> Without `FIREBASE_SERVICE_ACCOUNT_JSON`, `lib/fcm.ts` silently no-ops and only
> web push is sent — nothing breaks, native just stays dark until it's set.

### 3. Run the DB migration

Per the project's migration workflow (session pooler `--db-url`, 5432):
```
supabase db push --db-url "<session-pooler-url>"
```
This creates the `fcm_tokens` table.

### 4. Rebuild the APK

Same as before (remember the WINDOWS-ROOT truststore step to get past the NetFree
TLS filter):
```
cd bizmanager
npx cap sync android
cd android && ./gradlew assembleRelease
```
Install the new APK on the S25, open the app, and **accept the notification
permission prompt** when it appears.

## Verifying

1. Open the app on the phone (grant permission).
2. Confirm a row appears in `fcm_tokens` for that user.
3. Settings → Notifications → **send test** (or trigger a real alert).
4. It should arrive as a **heads-up banner** on the `bizh_alerts` channel, even
   with the app closed.

## Notes / gotchas

- The FCM message sets `android.priority: "high"` + `channelId: "bizh_alerts"`
  (`lib/fcm.ts`). Both the high priority **and** the HIGH-importance channel are
  required for the pop-up.
- Uninstalling/reinstalling the app rotates the FCM token; the old one is pruned
  automatically when FCM reports it as unregistered.
- iOS would need APNs setup too — this covers Android only.
