import type { CapacitorConfig } from '@capacitor/cli';

// BizH is a server-rendered Next.js app (SSR, API routes, Supabase cookie auth),
// so it cannot be bundled as static files. Instead this native Android shell
// loads the live deployment directly in its WebView. `webDir` only holds an
// offline fallback page shown when the device has no connection at launch.
const config: CapacitorConfig = {
  appId: 'com.bizh.app',
  appName: 'BizH',
  webDir: 'capacitor-shell',
  server: {
    // Load the canonical origin directly. www.biz-h.com is Vercel's production
    // domain; the apex biz-h.com only 307-redirects to it. Pointing at the apex
    // would force a launch-time redirect (and split the service worker across
    // two origins), so target www to stay single-origin.
    url: 'https://www.biz-h.com',
    androidScheme: 'https',
    // Only load secure content; never fall back to cleartext HTTP.
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
