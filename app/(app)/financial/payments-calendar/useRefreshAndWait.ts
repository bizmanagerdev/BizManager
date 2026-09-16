"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// A refresh that never completes (offline, server error) must not hold a dialog
// hostage — after this long the promise resolves regardless, and the user is
// told the board didn't catch up.
const REFRESH_WAIT_CAP_MS = 6_000;

// A router refresh that RESOLVES when the fresh data is on screen.
// `router.refresh()` inside a transition keeps `isRefreshing` true until the
// new server payload has been committed, so "went from refreshing to not" is
// exactly the moment the view shows the new rows. Dialogs await this so they
// close only once their item has visibly moved (or gone).
export function useRefreshAndWait() {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const refreshWaiters = useRef<Array<() => void>>([]);
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (wasRefreshing.current && !isRefreshing) {
      const waiters = refreshWaiters.current;
      refreshWaiters.current = [];
      for (const resolve of waiters) resolve();
    }
    wasRefreshing.current = isRefreshing;
  }, [isRefreshing]);

  const refreshAndWait = () =>
    new Promise<void>((resolve) => {
      // Offline: the save (if it went through the offline queue) will replay
      // later; nothing to wait for now, so say so and let the dialog close.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        toast.warning("אין חיבור — הלוח יתעדכן כשהחיבור יחזור");
        resolve();
        return;
      }
      const cap = setTimeout(() => {
        toast.warning("הלוח לא התרענן — רעננו את הדף כדי לראות את השינוי");
        resolve();
      }, REFRESH_WAIT_CAP_MS);
      refreshWaiters.current.push(() => {
        clearTimeout(cap);
        resolve();
      });
      startTransition(() => router.refresh());
    });

  return { isRefreshing, refreshAndWait };
}
