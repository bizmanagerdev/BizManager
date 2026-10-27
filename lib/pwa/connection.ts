import { useSyncExternalStore } from "react";

// Whether the server answers — not what the device claims. navigator.onLine
// stays true on a computer with any other network adapter up (the owner's
// laptop with its Wi-Fi off, 2026-10-27: no "no connection" bar, and the
// device pages asked the server they couldn't reach). So:
// - down when the device says so, or when the service worker saw a request
//   fail (public/sw.js, CONNECTION) and a ping confirms it — a single failed
//   request may only be one that was cancelled;
// - up again when the device says so, a request goes through, or a ping
//   answers (checked every PING_EVERY_MS while down).
// Kept up to date by watchConnection (components/pwa/PwaRegistration).

const PING_EVERY_MS = 5000;
const PING_TIMEOUT_MS = 4000;
// Remembered on the device while the server isn't answering, so the next page
// starts that way: with no connection every page change loads a saved page
// whole, and each one starting as "online" made the bar go and come back
// (owner, 2026-10-27: "these bars appear then disappear then reappear").
const DOWN_KEY = "bizh-server-down";
/** A note older than this says nothing about now (the device was put away offline, opened online later). */
const DOWN_NOTE_MS = 10 * 60 * 1000;

function downNoted(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DOWN_KEY) ?? "0") < DOWN_NOTE_MS;
  } catch {
    return false;
  }
}

function noteDown(down: boolean) {
  try {
    if (down) localStorage.setItem(DOWN_KEY, String(Date.now()));
    else localStorage.removeItem(DOWN_KEY);
  } catch {
    // Storage blocked: this page knows, the next one finds out.
  }
}

// A page the service worker answered with a saved copy (data-bizh-saved on
// <html>), or opened while the server wasn't answering a moment ago, starts as
// not answering — until a ping (at once) says otherwise.
let reachable =
  typeof navigator === "undefined"
    ? true
    : navigator.onLine && document.documentElement.dataset.bizhSaved === undefined && !downNoted();
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === reachable) return;
  reachable = next;
  noteDown(!next);
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Does the server answer, as far as this page knows? */
export function isServerReachable(): boolean {
  return reachable;
}

/** The same, for a component — re-renders when it changes. */
export function useServerReachable(): boolean {
  return useSyncExternalStore(subscribe, isServerReachable, () => true);
}

/** Run `callback` once, the next time the server answers (at once if it does now). Returns a cancel. */
export function whenServerReachable(callback: () => void): () => void {
  if (reachable) {
    callback();
    return () => {};
  }
  const unsubscribe = subscribe(() => {
    if (!reachable) return;
    unsubscribe();
    callback();
  });
  return unsubscribe;
}

async function ping(): Promise<boolean> {
  try {
    const res = await fetch("/api/ping", { cache: "no-store", signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/** A request failed (the service worker's word): down, if a ping confirms it. */
export async function checkConnection(): Promise<boolean> {
  const ok = await ping();
  set(ok);
  return ok;
}

/**
 * Keep the state up to date for this page: the device's own word, the
 * service worker's, and a ping every few seconds while down. Returns a stop.
 */
export function watchConnection(): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const pingWhileDown = () => {
    if (reachable) {
      clearInterval(timer);
      timer = undefined;
    } else if (!timer) {
      timer = setInterval(() => {
        if (navigator.onLine) void checkConnection();
      }, PING_EVERY_MS);
    }
  };
  const stopListening = subscribe(pingWhileDown);
  const onOnline = () => void checkConnection();
  const onOffline = () => set(false);
  const onWorkerMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; online?: boolean } | null;
    if (data?.type !== "CONNECTION") return;
    if (data.online) set(true);
    else void checkConnection();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
  // Opened on a saved copy (the service worker's answer when the server
  // didn't), or right after the server stopped answering: find out at once
  // rather than trusting the device.
  if (!navigator.onLine) set(false);
  else if (!reachable) void checkConnection();
  pingWhileDown();
  return () => {
    stopListening();
    clearInterval(timer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
  };
}
