"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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

export default function PushSubscribeButton() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    getCurrentSubscription().then((sub) => {
      setStatus(sub ? "subscribed" : "unsubscribed");
    });
  }, []);

  async function subscribe() {
    setStatus("loading");
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
      await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: keys?.p256dh ?? "",
          auth: keys?.auth ?? "",
        }),
      });
      setStatus("subscribed");
    } catch {
      setStatus("unsubscribed");
    }
  }

  async function unsubscribe() {
    setStatus("loading");
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
    } catch {
      setStatus("unsubscribed");
    }
  }

  if (status === "loading") {
    return (
      <Button variant="outline" size="sm" disabled>
        ...
      </Button>
    );
  }

  if (status === "unsupported") return null;

  if (status === "denied") {
    return (
      <Button variant="outline" size="sm" disabled>
        התראות חסומות בדפדפן
      </Button>
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
