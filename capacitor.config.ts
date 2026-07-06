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
    url: 'https://biz-h.com',
    androidScheme: 'https',
    // Only load secure content; never fall back to cleartext HTTP.
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
