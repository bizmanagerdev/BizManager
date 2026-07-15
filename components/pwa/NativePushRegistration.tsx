"use client";

import { useEffect } from "react";
import { enableNativePush } from "@/lib/native-push";

// On launch inside the Capacitor APK, register the device with Firebase Cloud
// Messaging so alerts reach it. In a normal browser enableNativePush() detects
// the non-native platform and no-ops — the browser PWA path (PushSubscribeButton
// + service worker) handles that case instead. See lib/native-push.ts.
export default function NativePushRegistration() {
  useEffect(() => {
    void enableNativePush();
  }, []);

  return null;
}
