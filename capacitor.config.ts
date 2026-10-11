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
    // No `errorPath`: with one, Capacitor swaps the page for that file on ANY
    // main-frame load error, including the one Android reports while the site's
    // service worker is still answering from its saved copy. In APK 1.1.0 that
    // threw the app out to a local "no connection" page offline, even with the
    // page saved (owner, 2026-10-11: "if I click something that wasn't open
    // before it went offline … I lose the whole app"). Offline belongs to the
    // service worker (public/sw.js), which keeps the user inside the app.
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
