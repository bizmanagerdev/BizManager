import type { CapacitorConfig } from '@capacitor/cli';

// BizH is a server-rendered Next.js app (SSR, API routes, Supabase cookie auth),
// so it cannot be bundled as static files. Instead this native Android shell
// loads the live deployment directly in its WebView. `webDir` only holds the
// no-signal page (offline.html) shown when the site can't be reached at all.
const config: CapacitorConfig = {
  appId: 'com.bizh.app',
  appName: 'BizH',
  webDir: 'capacitor-shell',
  // The web view's own colour before the page paints: the opening screen's and
  // the phone dashboard's light blue, never white or black (the "black screen").
  backgroundColor: '#ECF5FE',
  server: {
    // Load the canonical origin directly. www.biz-h.com is Vercel's production
    // domain; the apex biz-h.com only 307-redirects to it. Pointing at the apex
    // would force a launch-time redirect (and split the service worker across
    // two origins), so target www to stay single-origin.
    // Straight to /dashboard: the bare site went / → /login → /dashboard, two
    // extra trips to the server on every app open (about 1.4 s, measured
    // 2026-10-07). A signed-out phone still ends up on the login page.
    url: 'https://www.biz-h.com/dashboard',
    androidScheme: 'https',
    // Only load secure content; never fall back to cleartext HTTP.
    cleartext: false,
    // Shown instead of Android's "Webpage not available" when neither the site
    // nor its offline copy loads (served from the app itself, capacitor-shell/).
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
    // Test builds only: `CAP_WEBVIEW_DEBUG=1 npx cap copy android` lets a computer
    // inspect the app's web view (testing on an emulator). Off in every APK that
    // goes to phones: run `npx cap copy android` without it before building one.
    webContentsDebuggingEnabled: process.env.CAP_WEBVIEW_DEBUG === '1',
  },
  plugins: {
    // Reminders the phone keeps itself use the same white mark as push
    // notifications, tinted blue.
    LocalNotifications: {
      smallIcon: 'ic_stat_bizh',
      iconColor: '#0369A1',
    },
  },
};

export default config;
