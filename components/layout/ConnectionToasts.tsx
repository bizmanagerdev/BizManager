"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";

type ConnDetail = { label?: string; count?: number; reason?: string };

/**
 * Single, app-wide source of connection feedback. Every write that goes through
 * offlineFetch emits events; this turns them into consistent toasts so the user
 * always knows what happened to their action — whether it saved, is waiting on
 * the connection, is taking too long, or failed — no matter which screen they're
 * on. Toasts are coalesced by id so a burst never spams the screen.
 */
export default function ConnectionToasts() {
  const router = useRouter();

  useEffect(() => {
    const onSlow = (e: Event) => {
      const { label } = ((e as CustomEvent).detail ?? {}) as ConnDetail;
      toast.loading(label ? `החיבור איטי — שומר את ${label}...` : "החיבור איטי — שומר...", {
        id: "conn-slow",
        duration: 8000,
      });
    };

    const onQueued = (e: Event) => {
      const { label } = ((e as CustomEvent).detail ?? {}) as ConnDetail;
      toast.dismiss("conn-slow");
      toast.info(
        label
          ? `${label} נשמר במכשיר — יישלח אוטומטית כשיחזור החיבור`
          : "הפעולה נשמרה במכשיר — תישלח אוטומטית כשיחזור החיבור",
        { id: `conn-queued-${Date.now()}` }
      );
    };

    const onSynced = (e: Event) => {
      const { count = 0 } = ((e as CustomEvent).detail ?? {}) as ConnDetail;
      toast.dismiss("conn-slow");
      toast.success(count > 1 ? `${count} פעולות נשלחו ונשמרו בשרת` : "הפעולה נשלחה ונשמרה בשרת", {
        id: "conn-synced",
      });
      // Pull the freshly-synced records into the current view.
      router.refresh();
    };

    const onFailed = (e: Event) => {
      const { count = 0 } = ((e as CustomEvent).detail ?? {}) as ConnDetail;
      toast.error(
        count > 1 ? `${count} פעולות לא נשמרו בשרת — יש לנסות שוב` : "פעולה לא נשמרה בשרת — יש לנסות שוב",
        { id: "conn-failed" }
      );
    };

    window.addEventListener(CONNECTION_EVENTS.slow, onSlow);
    window.addEventListener(CONNECTION_EVENTS.queued, onQueued);
    window.addEventListener(CONNECTION_EVENTS.synced, onSynced);
    window.addEventListener(CONNECTION_EVENTS.failed, onFailed);

    return () => {
      window.removeEventListener(CONNECTION_EVENTS.slow, onSlow);
      window.removeEventListener(CONNECTION_EVENTS.queued, onQueued);
      window.removeEventListener(CONNECTION_EVENTS.synced, onSynced);
      window.removeEventListener(CONNECTION_EVENTS.failed, onFailed);
    };
  }, [router]);

  return null;
}
