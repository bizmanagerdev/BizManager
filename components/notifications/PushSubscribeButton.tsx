"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  isNativePlatform,
  enableNativePush,
  disableNativePush,
  nativePermissionStatus,
} from "@/lib/native-push";
import { ShareIcon } from "@/components/ui/icons";

type Status = "loading" | "unsupported" | "denied" | "subscribed" | "unsubscribed";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ reports as "Macintosh" but is touch-capable — cover that too.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && "ontouchend" in document)
  );
}

function isInstalledPWA(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// Prominent, unmissable box telling an iPhone user they must install the app to
// the home screen before web push can work at all (iOS platform limitation).
function IOSInstallWarning() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">כדי לקבל התראות באייפון צריך להתקין את האפליקציה למסך הבית</p>
      <p className="mt-1 leading-relaxed">
        באייפון, התראות עובדות רק כשהאתר מותקן כאפליקציה. פתחו את BizManager בדפדפן Safari, לחצו על
        כפתור השיתוף <ShareIcon className="inline h-3.5 w-3.5 align-text-bottom" /> ← בחרו{" "}
        <span className="font-semibold">״הוסף למסך הבית״</span>, ואז פתחו את האפליקציה מסמל שנוצר —
        ורק אז הפעילו התראות.
      </p>
    </div>
  );
}

export default function PushSubscribeButton() {
  const [status, setStatus] = useState<Status>("loading");
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Native (Capacitor APK): the WebView has no PushManager, so route through
      // the FCM path instead of web push. Do this first so we never fall into
      // the "unsupported browser" branch below.
      if (await isNativePlatform()) {
        if (cancelled) return;
        setNative(true);
        const perm = await nativePermissionStatus();
        if (cancelled) return;
        setStatus(perm === "granted" ? "subscribed" : perm === "denied" ? "denied" : "unsubscribed");
        return;
      }

      const iosNotInstalled = detectIOS() && !isInstalledPWA();
      if (!cancelled) setShowIOSHelp(iosNotInstalled);

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      const sub = await getCurrentSubscription();
      if (!cancelled) setStatus(sub ? "subscribed" : "unsubscribed");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    setStatus("loading");

    // Native APK: register with FCM instead of web push.
    if (native) {
      const result = await enableNativePush();
      if (result === "granted") {
        setStatus("subscribed");
        toast.success("ההתראות הופעלו למכשיר זה");
      } else if (result === "denied") {
        setStatus("denied");
        toast.error("ההתראות חסומות בהגדרות המכשיר.");
      } else {
        setStatus("unsubscribed");
        toast.error("הפעלת ההתראות נכשלה. נסו שוב.");
      }
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const json = sub.toJSON();
      const keys = json.keys as { p256dh?: string; auth?: string } | undefined;
      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: keys?.p256dh ?? "",
          auth: keys?.auth ?? "",
        }),
      });
      // The save to the server MUST succeed — otherwise the cron has no record
      // and the "subscribed" button would be lying. Roll back on failure.
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        setStatus("unsubscribed");
        toast.error("שמירת ההתראות נכשלה. בדקו את החיבור ונסו שוב.");
        return;
      }
      setStatus("subscribed");
      toast.success("ההתראות הופעלו למכשיר זה");
    } catch {
      setStatus("unsubscribed");
      toast.error("הפעלת ההתראות נכשלה. נסו שוב.");
    }
  }

  async function unsubscribe() {
    setStatus("loading");

    // Native APK: drop the FCM token server-side.
    if (native) {
      await disableNativePush();
      setStatus("unsubscribed");
      toast.success("ההתראות כובו למכשיר זה");
      return;
    }

    try {
      const sub = await getCurrentSubscription();
      if (sub) {
        await fetch("/api/notifications/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("unsubscribed");
      toast.success("ההתראות כובו למכשיר זה");
    } catch {
      setStatus("unsubscribed");
    }
  }

  // On an iPhone that isn't installed, push can never work — show the install
  // guide instead of a dead/hidden button.
  if (showIOSHelp && (status === "unsupported" || status === "unsubscribed")) {
    return <IOSInstallWarning />;
  }

  if (status === "loading") {
    return (
      <Button variant="outline" size="sm" disabled>
        ...
      </Button>
    );
  }

  if (status === "unsupported") {
    return (
      <p className="text-sm text-muted-foreground">הדפדפן הזה לא תומך בהתראות.</p>
    );
  }

  if (status === "denied") {
    return (
      <div className="space-y-2">
        <Button variant="outline" size="sm" disabled>
          התראות חסומות בדפדפן
        </Button>
        <p className="text-sm text-muted-foreground">
          ההתראות חסומות בהגדרות המכשיר. יש לאפשר אותן בהגדרות הדפדפן/המכשיר ואז לרענן.
        </p>
      </div>
    );
  }

  if (status === "subscribed") {
    return (
      <Button variant="outline" size="sm" onClick={unsubscribe}>
        כבה התראות
      </Button>
    );
  }

  return (
    <Button variant="default" size="sm" onClick={subscribe}>
      הפעל התראות לטלפון
    </Button>
  );
}
