"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { loadSnapshot, saveSnapshot } from "@/lib/offline-cache";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Live online/offline via useSyncExternalStore (no hydration mismatch, no post-paint setState). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  );
}

/**
 * Make a server-fed list readable offline. While online it persists the loaded
 * rows to IndexedDB; while offline it serves the last persisted set (which
 * survives deploys, unlike the service-worker page cache, and is the FULL list
 * rather than just the first SSR page). Returns whether we're offline and when
 * the served snapshot was captured, so the caller can show a freshness badge and
 * switch to in-memory search.
 *
 * Pass `key = null` to disable caching for a particular scope (e.g. a
 * customer-filtered or otherwise non-canonical view).
 */
export function useOfflineRows<T>(
  key: string | null,
  liveRows: T[]
): { rows: T[]; offline: boolean; savedAt: number | null } {
  const online = useOnline();
  const [snapshot, setSnapshot] = useState<{ data: T[]; savedAt: number } | null>(null);

  // Persist whenever we have live rows online, so the newest full list is ready
  // for the next time there's no signal.
  useEffect(() => {
    if (!key) return;
    if (online && liveRows.length > 0) void saveSnapshot(key, liveRows);
  }, [key, online, liveRows]);

  // Load the snapshot when offline (kept for fallback rendering + search).
  useEffect(() => {
    if (!key || online) return;
    let cancelled = false;
    void loadSnapshot<T[]>(key).then((s) => {
      if (!cancelled && s) setSnapshot(s);
    });
    return () => {
      cancelled = true;
    };
  }, [key, online]);

  const offline = !online;
  // Offline, prefer the snapshot when it's fuller than whatever SSR left us with
  // (a cached page only carries its first page of rows).
  const usingSnapshot =
    offline && snapshot != null && (liveRows.length === 0 || snapshot.data.length > liveRows.length);

  return {
    rows: usingSnapshot ? snapshot!.data : liveRows,
    offline,
    savedAt: usingSnapshot ? snapshot!.savedAt : null,
  };
}
