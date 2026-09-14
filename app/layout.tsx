import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import PwaRegistration from "@/components/pwa/PwaRegistration";
import NativePushRegistration from "@/components/pwa/NativePushRegistration";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: "BizH",
  description: "מערכת ניהול עסק",
  manifest: "/manifest.webmanifest",
  // TAB vs INSTALLED APP are deliberately different artwork:
  //   tab   — the bare sky mark, no background (app/icon.svg → favicon.ico)
  //   app   — the same mark on a navy tile (public/brand/heller-tile.svg → PNGs)
  // So `icons.icon` lists ONLY the transparent set. The 192/512 tiles used to be
  // in here too, which let a browser pick a navy square for the tab strip; they
  // belong to the manifest, which is what install and the home screen read.
  // `app/icon.svg` is also picked up by Next's file convention and takes
  // precedence over this list — it's the real tab icon; favicon.ico is the
  // fallback for anything that requests /favicon.ico directly.
  //
  // Bump ?v= whenever the artwork changes (v4 = the Heller mark, was the "H").
  // Favicons are cached about as hard as anything on the web.
  icons: {
    icon: [
      { url: "/favicon.ico?v=4", sizes: "any" },
      // The vector too, so a HiDPI tab strip gets crisp edges instead of a 32px
      // bitmap. NOTE: setting `metadata.icons` at all means Next stops emitting
      // the <link> for the app/icon.svg file convention — this entry is what
      // actually puts the SVG in the tab. (Both URLs resolve to app/icon.svg.)
      { url: "/icon.svg?v=4", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico?v=4",
    apple: "/apple-touch-icon.png?v=2",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BizH",
  },
};

export const viewport: Viewport = {
  // The browser's own bar sits directly above our top bar, so it must be the
  // SAME navy — this is --primary (#0A1020). Next metadata can't read a CSS
  // variable, so if --primary ever changes, change this literal with it.
  themeColor: "#0A1020",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the head script below intentionally sets the
    // --font-scale style on <html> from localStorage BEFORE hydration (no-FOUC),
    // so the server-rendered attribute can never match the client.
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Self-heal a stale service-worker cache serving an old page whose JS chunk
            references no longer exist on the server (confirmed live 2026-09-14: a
            worker's connection dropped mid-navigation during a burst of deploys,
            the SW's 8s navigation timeout fell back to a cached page from an older
            build, and that page's script tags 404'd — React never got far enough to
            mount, so neither app/(app)/error.tsx NOR app/global-error.tsx could catch
            it (both are React error boundaries; a <script src> load failure isn't a
            React error), and nothing reached Sentry (it never got to initialize).
            This has to be a plain window-level listener, and it has to be the FIRST
            script in <head> — before Next's own framework scripts run — so it's
            listening before the failure it exists to catch. Capture-phase 'error' on
            window is the only way to observe a script/link tag's load failure at
            all (those don't bubble); 'unhandledrejection' covers the same failure
            when it instead surfaces as a rejected dynamic import(). One guarded
            reload (sessionStorage, same pattern as PwaRegistration's __sw_reloaded__)
            re-navigates through the service worker fresh, which is enough to recover
            since the SW purges old caches on every version activate — it just never
            got the chance to before now.
            The regex/key here are kept in sync BY HAND with lib/ui/auto-recover.ts
            (which handles the sibling case — a render error a React boundary DOES
            get to catch, e.g. the "Rendered more hooks" hydration-mismatch variant
            confirmed live the same day) — this script can't import that module, it
            has to exist before any module graph does. Same sessionStorage key on
            purpose, so only one reload ever fires regardless of which path notices
            the stale build first.
            PRODUCTION ONLY, same reason as auto-recover.ts's own guard: Next's
            dev-mode Fast Refresh can throw the exact "Rendered more/fewer hooks"
            text transiently and harmlessly when swapping a component mid-render —
            e2e tests run against `npm run dev`, and this script reloading on that
            wiped a running test's state, confirmed live 2026-09-14 as 34 e2e
            failures across totally unrelated spec files. Rendered conditionally
            (not a runtime check inside the string) since this script exists before
            any module graph — process.env.NODE_ENV is a build-time substitution
            Next's compiler makes on the SOURCE FILE, same mechanism PwaRegistration
            already relies on for its own dev/production branch. */}
        {process.env.NODE_ENV === "production" ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var K="__chunk_reload__";var RX=/ChunkLoadError|Loading chunk [\\w.-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Rendered (more|fewer) hooks than (during the previous render|expected)/i;function isStaticAsset(el){if(!el||!el.tagName)return false;var tag=el.tagName.toLowerCase();if(tag!=="script"&&tag!=="link")return false;var src=el.src||el.href||"";return src.indexOf("/_next/")!==-1;}function reloadOnce(){if(sessionStorage.getItem(K))return;sessionStorage.setItem(K,"1");location.reload();}window.addEventListener("error",function(e){if(isStaticAsset(e.target)){reloadOnce();return;}var msg=e.error&&e.error.message?e.error.message:e.message;if(msg&&RX.test(msg))reloadOnce();},true);window.addEventListener("unhandledrejection",function(e){var msg=e.reason&&e.reason.message?e.reason.message:String(e.reason||"");if(RX.test(msg))reloadOnce();});}catch(e){}`,
            }}
          />
        ) : null}
        {/* Apply the saved global text-size multiplier before first paint.
            Migrates the legacy absolute-px key (biz-font-size) to a scale. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var d=document.documentElement;var s=localStorage.getItem('biz-font-scale');if(!s){var px=parseFloat(localStorage.getItem('biz-font-size'));if(px>0){s=String(px/17);localStorage.setItem('biz-font-scale',s);}}if(s){d.style.setProperty('--font-scale',s);}var m=localStorage.getItem('biz-font-scale-mobile');if(m){d.style.setProperty('--font-scale-mobile',m);}}catch(e){}` }} />
      </head>
      <body className="antialiased">
        <PwaRegistration />
        <NativePushRegistration />
        {children}
        <Toaster />
        <SpeedInsights />
      </body>
    </html>
  );
}
