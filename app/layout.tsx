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
