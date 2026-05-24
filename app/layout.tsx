import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import PwaRegistration from "@/components/pwa/PwaRegistration";

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
  themeColor: "#1D2848",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body className="antialiased">
        <PwaRegistration />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
