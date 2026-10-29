"use client";

import { createContext, useContext, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isServerReachable } from "@/lib/pwa/connection";

// A refresh that never completes (offline, server error) must not hold a dialog
// hostage — after this long the promise resolves regardless, and the user is
// told the board didn't catch up.
const REFRESH_WAIT_CAP_MS = 6_000;

/**
 * The board drawn from the device copy (LocalPaymentsCalendarPage): the data
 * on screen. A save goes to the server and comes back through the copy, which
 * draws the board again — a server refresh would answer before that and close
 * the window with the old board still showing. So on the device version the
 * wait is for the board's next data (owner, 2026-10-04: "I can't have it close
 * without the change on the page already").
 */
export const DeviceBoardData = createContext<unknown>(undefined);

// A refresh that RESOLVES when the fresh data is on screen.
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

  // The device version: released when the copy hands the board new data.
  const deviceData = useContext(DeviceBoardData);
  const onDevice = deviceData !== undefined;
  const deviceWaiters = useRef<Array<() => void>>([]);
  const lastDeviceData = useRef(deviceData);
  useEffect(() => {
    if (deviceData === lastDeviceData.current) return;
    lastDeviceData.current = deviceData;
    const waiters = deviceWaiters.current;
    deviceWaiters.current = [];
    for (const resolve of waiters) resolve();
  }, [deviceData]);

  const refreshAndWait = () =>
    new Promise<void>((resolve) => {
      // No server (never navigator.onLine — a laptop says online with the
      // Wi-Fi off): the save (if it went through the offline queue) will
      // replay later; nothing to wait for now, so say so and let the dialog close.
      if (!isServerReachable()) {
        toast.warning("אין חיבור — הלוח יתעדכן כשהחיבור יחזור");
        resolve();
        return;
      }
      const waiters = onDevice ? deviceWaiters : refreshWaiters;
      const cap = setTimeout(() => {
        waiters.current = waiters.current.filter((w) => w !== done);
        toast.warning(
          onDevice
            ? "השינוי נשמר — הלוח יתעדכן ברגע שהעותק במכשיר יקבל אותו"
            : "הלוח לא התרענן — רעננו את הדף כדי לראות את השינוי"
        );
        resolve();
      }, REFRESH_WAIT_CAP_MS);
      const done = () => {
        clearTimeout(cap);
        resolve();
      };
      waiters.current.push(done);
      if (!onDevice) startTransition(() => router.refresh());
    });

  return { isRefreshing, refreshAndWait };
}
