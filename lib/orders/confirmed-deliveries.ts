"use client";

import { useSyncExternalStore } from "react";

// Orders confirmed as fully delivered on this device, until the lists catch up
// (owner, 2026-10-11). With no signal the confirmation waits in the send queue
// and the lists still show the order — a driver could confirm it again (a
// second payment). The order leaves the deliveries lists the moment it's
// confirmed instead; the server's own copy no longer lists it once the
// confirmation arrives, so a mark only has to outlive the wait.

const KEY = "bizh-confirmed-deliveries";
const EVENT = "bizh:confirmed-deliveries";
/** Long enough for a phone to get back online; the server's lists take over by then. */
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

function read(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([id, at]) => typeof id === "string" && typeof at === "number" && now - at < KEEP_MS)
    );
  } catch {
    return {};
  }
}

/** The order was confirmed as fully delivered here — take it off the lists now. */
export function markDeliveryConfirmed(orderId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [orderId]: Date.now() }));
  } catch {
    // Storage unavailable: the lists catch up when the confirmation arrives.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

let snapshot = "";
let ids: ReadonlySet<string> = new Set();
function currentIds(): ReadonlySet<string> {
  const next = typeof window === "undefined" ? "" : Object.keys(read()).sort().join(",");
  if (next !== snapshot) {
    snapshot = next;
    ids = new Set(next ? next.split(",") : []);
  }
  return ids;
}

const EMPTY: ReadonlySet<string> = new Set();

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The orders to leave out of a deliveries list (empty on the server). */
export function useConfirmedDeliveries(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, currentIds, () => EMPTY);
}
