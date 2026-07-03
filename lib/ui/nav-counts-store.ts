"use client";

import { useEffect, useSyncExternalStore } from "react";

// Shared store for the sidebar count badges. One poll feeds every consumer
// (sidebar today, bottom nav later). Counts are keyed by nav URL.

export type NavCount = { count: number; severity: "danger" | "warning" | "info" };
type CountsMap = Record<string, NavCount>;

let counts: CountsMap = {};
const listeners = new Set<() => void>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

async function fetchCounts() {
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

/** Re-pull now (e.g. after resolving an alert). */
export function refreshNavCounts() {
  void fetchCounts();
}

export function useNavCounts(): CountsMap {
  const snapshot = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => counts,
    () => counts,
  );

  useEffect(() => {
    if (started) return;
    started = true;
    void fetchCounts();
    const timer = setInterval(() => void fetchCounts(), 60_000);
    const onFocus = () => void fetchCounts();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      started = false;
    };
  }, []);

  return snapshot;
}
