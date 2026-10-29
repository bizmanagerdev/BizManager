"use client";

import { useEffect, useSyncExternalStore } from "react";

// Shared store for the menu count badges: the computer's side menu and the
// phone's bottom menu (and its "עוד" sheet). One ask feeds every badge.
// Counts are keyed by nav URL.
//
// It asks only while someone can see the numbers (owner, 2026-10-29 — it was
// every minute from every open copy, 19,367 times a week, about 5x the busiest
// page, most of it from hidden windows and from phones that never showed them):
// - only while the window is on screen; coming back to it asks at once;
// - only for the menu this screen shows: both menus are mounted everywhere and
//   CSS hides one, so each says whether it's the one on screen (`poll`);
// - the phone's "עוד" sheet asks again when it opens (refreshNavCounts).

export type NavCount = { count: number; severity: "danger" | "warning" | "info" };
type CountsMap = Record<string, NavCount>;

export const NAV_COUNTS_POLL_MS = 60_000;
// Coming back to the window fires both visibilitychange and focus, and a
// computer's focus comes and goes with every click between windows: one ask
// for all of that.
const SETTLE_MS = 15_000;

let counts: CountsMap = {};
// What the server drew: no counts. A menu hydrating after the other one has
// already asked (the side menu waits in a Suspense) starts from this too, or
// its badges wouldn't match the server's HTML.
const NO_COUNTS: CountsMap = {};
const listeners = new Set<() => void>();
let pollers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastAskedAt = 0;

function emit() {
  for (const l of listeners) l();
}

function onScreen() {
  return document.visibilityState === "visible";
}

async function fetchCounts() {
  lastAskedAt = Date.now();
  try {
    const res = await fetch("/api/reminders/nav-counts", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json().catch(() => null)) as { counts?: CountsMap } | null;
    if (json && json.counts && typeof json.counts === "object") {
      counts = json.counts;
      emit();
    }
  } catch {
    // offline / transient — keep the last known counts
  }
}

// The minute's ask runs while a menu that's on screen is mounted and the
// window is visible — and not otherwise.
function syncTimer() {
  const wanted = pollers > 0 && onScreen();
  if (wanted && timer === null) timer = setInterval(() => void fetchCounts(), NAV_COUNTS_POLL_MS);
  if (!wanted && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function onBack() {
  syncTimer();
  if (pollers > 0 && onScreen() && Date.now() - lastAskedAt > SETTLE_MS) void fetchCounts();
}

/** Re-pull now (e.g. after resolving an alert, or opening the phone's "עוד"). */
export function refreshNavCounts() {
  void fetchCounts();
}

/**
 * The counts, for a menu. `poll`: this menu is the one this screen shows — it
 * keeps the numbers fresh while the window is on screen. A menu that's hidden
 * here reads the same numbers and asks for nothing.
 */
export function useNavCounts({ poll }: { poll: boolean }): CountsMap {
  const snapshot = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => counts,
    () => NO_COUNTS,
  );

  useEffect(() => {
    if (!poll) return;
    pollers += 1;
    if (pollers === 1) {
      document.addEventListener("visibilitychange", onBack);
      window.addEventListener("focus", onBack);
    }
    if (onScreen() && Date.now() - lastAskedAt > SETTLE_MS) void fetchCounts();
    syncTimer();
    return () => {
      pollers -= 1;
      if (pollers === 0) {
        document.removeEventListener("visibilitychange", onBack);
        window.removeEventListener("focus", onBack);
      }
      syncTimer();
    };
  }, [poll]);

  return snapshot;
}
