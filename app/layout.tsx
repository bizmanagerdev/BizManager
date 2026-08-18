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
  icons: {
    icon: [
      { url: "/favicon.ico?v=3", sizes: "any" },
      { url: "/icon-192.png?v=1", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png?v=1", type: "image/png", sizes: "512x512" },
      { url: "/icon.svg?v=3", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico?v=3",
    apple: "/apple-touch-icon.png?v=1",
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
