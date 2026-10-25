"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";
import { savesWaiting } from "@/lib/offline-send";

/**
 * The page read again after a save (router.refresh) — but not while a save waits on this device for the
 * connection: the server can't answer, and Next.js then loads the page whole, from the copy saved on the device
 * (owner's offline test, 2026-10-25: an expense added on a property's page with no connection, then
 * "אירעה תקלה בטעינת הדף"). The save is in the waiting list meanwhile; once the waiting saves go out, the page
 * reads itself again (`whenSent`, on by default — off for a dialog inside a page that already does).
 */
export function useOfflineSafeRefresh({ whenSent = true }: { whenSent?: boolean } = {}): () => void {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!whenSent) return;
    const onSent = () => startTransition(() => router.refresh());
    window.addEventListener(CONNECTION_EVENTS.synced, onSent);
    return () => window.removeEventListener(CONNECTION_EVENTS.synced, onSent);
  }, [router, whenSent]);

  return useCallback(() => {
    void savesWaiting().then((waiting) => {
      if (!waiting) startTransition(() => router.refresh());
    });
  }, [router]);
}
