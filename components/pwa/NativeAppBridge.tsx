"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { startNativeAppBridge, syncNativeStatusBar } from "@/lib/native-app";

// Switches on the phone app's own abilities from the website (opening screen,
// downloads, printing, the back button, the status bar's colour). In a browser,
// and in phones still on the old APK, each part detects that and does nothing.
// See lib/native-app.ts.
export default function NativeAppBridge() {
  const pathname = usePathname();

  useEffect(() => {
    void startNativeAppBridge();
  }, []);

  useEffect(() => {
    void syncNativeStatusBar();
  }, [pathname]);

  return null;
}
