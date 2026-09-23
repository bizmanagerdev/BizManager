"use client";

import { useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/native-share";

// Should the meeting's agenda links open in a NEW tab?
//
// On the shared screen in the room, yes: tapping "פתיחת גבייה" must not take
// the agenda off the wall, because losing your place mid-meeting is the one
// thing that actually costs time. The meeting page keeps running behind the
// tab, and the ticks and notes are server-side anyway.
//
// But only on a real desktop browser:
//   • In the Capacitor APK / WebView, target="_blank" on an INTERNAL route does
//     not open a tab — it hands the URL to the system browser, which has its
//     own cookie jar and lands the user on a logged-out page. (The app's other
//     _blank links are all EXTERNAL — WhatsApp, Waze, Morning — where leaving
//     the app is the intent. This is the opposite case.)
//   • On a phone there is no second tab to speak of and Back is the natural
//     gesture.
//
// Starts false so the server and the first client render agree; it can only
// widen to true after mount. Measured once — a wall-mounted screen does not
// get resized mid-meeting.
export function useOpenInNewTab(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 64rem)").matches) return;
    let active = true;
    void isNativePlatform()
      .then((native) => {
        if (active && !native) setEnabled(true);
      })
      .catch(() => {
        // Can't tell what we're running in — leave links in the same tab, the
        // behaviour that works everywhere.
      });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
}
