"use client";

import { useCallback, useEffect, useState } from "react";
import {
  customerMatchScore,
  customerMatchesQuery,
  normalizeSearchText,
  type CustomerSearchFields,
} from "@/lib/search/customerMatch";
import { fetchSearchIndex } from "@/lib/search/fetchSearchIndex";
import type { CustomerSearchIndexEntry } from "@/app/(app)/customers/loadCustomers";
import { loadSnapshot, saveSnapshot } from "@/lib/offline-cache";

export type { CustomerSearchIndexEntry };

const TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_KEY = "customer-search-index";

// Module-level cache shared by every consumer so the whole customer list is
// fetched once per session, not per component. `stale` marks a copy served from
// the offline snapshot (server unreachable) rather than a fresh online load.
let cache: { data: CustomerSearchIndexEntry[]; loadedAt: number; stale: boolean } | null = null;
let inflight: Promise<CustomerSearchIndexEntry[]> | null = null;
const listeners = new Set<() => void>();

/** Freshness of the current index — for a "showing offline data from HH:MM" cue. */
export function getCustomerIndexMeta(): { stale: boolean; savedAt: number | null } {
  return { stale: cache?.stale ?? false, savedAt: cache?.loadedAt ?? null };
}

async function loadIndex(force = false): Promise<CustomerSearchIndexEntry[]> {
  // A fresh (non-stale) cache within TTL short-circuits; a stale cache always
  // re-attempts the server so it refreshes as soon as the connection is back.
  if (!force && cache && !cache.stale && Date.now() - cache.loadedAt < TTL_MS) return cache.data;
  if (!force && inflight) return inflight;
  inflight = fetchSearchIndex<CustomerSearchIndexEntry>("customers")
    .then((customers) => {
      cache = { data: customers, loadedAt: Date.now(), stale: false };
      // Persist the directory so customer lookup keeps working with no signal.
      void saveSnapshot(SNAPSHOT_KEY, customers);
      return customers;
    })
    .catch(async (err) => {
      // Offline / server unreachable → serve the last persisted directory so
      // name+phone lookup still works, flagged stale with its capture time.
      const snap = await loadSnapshot<CustomerSearchIndexEntry[]>(SNAPSHOT_KEY);
      if (snap && Array.isArray(snap.data)) {
        cache = { data: snap.data, loadedAt: snap.savedAt, stale: true };
        return snap.data;
      }
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Drop the cached index and reload any mounted consumers (call after a customer
 * is created/edited so it becomes searchable immediately).
 */
export function invalidateCustomerSearchIndex() {
  cache = null;
  listeners.forEach((notify) => notify());
}

/** Filter + rank the index in memory using the shared matching rules. */
export function searchCustomerEntries(
  entries: CustomerSearchIndexEntry[],
  query: string,
  limit = 50
): CustomerSearchIndexEntry[] {
  const q = query.trim();
  if (!q) return entries.slice(0, limit);
  const matched = entries.filter((entry) => customerMatchesQuery(entry as CustomerSearchFields, q));
  matched.sort((left, right) => {
    const scoreLeft = customerMatchScore(left as CustomerSearchFields, q);
    const scoreRight = customerMatchScore(right as CustomerSearchFields, q);
    if (scoreLeft !== scoreRight) return scoreLeft - scoreRight;
    return normalizeSearchText(left.name).localeCompare(normalizeSearchText(right.name), "he");
  });
  return matched.slice(0, limit);
}

/**
 * Customer search index: loads ALL customers (lightweight, with contacts) once,
 * caches it module-wide, and searches it in memory so customer type-ahead is
 * instant — no per-keystroke network round-trip. Matching uses the same shared
 * rules as the server (fuzzy Hebrew names, phone↔whatsapp cross-match).
 */
export function useCustomerSearchIndex({
  deferUntilIdle = false,
}: {
  /**
   * Wait for the page to go idle before the first load. For a caller that's
   * mounted on every page but only needs the list later — the top bar's search
   * uses it purely as its offline fallback — so it doesn't compete with the
   * page's own loading. Pickers leave this off: they need the list now.
   */
  deferUntilIdle?: boolean;
} = {}) {
  const [entries, setEntries] = useState<CustomerSearchIndexEntry[]>(cache?.data ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<boolean>(cache?.stale ?? false);
  const [savedAt, setSavedAt] = useState<number | null>(cache?.loadedAt ?? null);
  // Whether the list is wanted yet: at once, unless the caller defers it — then
  // when the page goes idle, or the moment `load()` says it's needed (the
  // search box focused before then).
  const [wanted, setWanted] = useState(() => !deferUntilIdle || cache !== null);

  const syncMeta = useCallback(() => {
    const meta = getCustomerIndexMeta();
    setStale(meta.stale);
    setSavedAt(meta.savedAt);
  }, []);

  useEffect(() => {
    if (wanted) return;
    const want = () => setWanted(true);
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(want, { timeout: 5000 }) : window.setTimeout(want, 2000);
    return () => {
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [wanted]);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    // loadIndex resolves instantly from the module cache when it is warm, so
    // this paints synchronously-ish without a network round-trip; only the
    // first cold load actually hits the server (or the offline snapshot).
    loadIndex()
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setLoading(false);
        setError(null);
        syncMeta();
      })
      .catch(() => {
        if (cancelled) return;
        setError("שגיאת טעינת רשימת הלקוחות");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syncMeta, wanted]);

  /** Load it now (a deferred caller's search box was focused) — a no-op once it's wanted. */
  const load = useCallback(() => setWanted(true), []);

  // Reload when the index is invalidated (e.g. after a customer is created).
  useEffect(() => {
    const onInvalidate = () => {
      loadIndex(true)
        .then((data) => {
          setEntries(data);
          syncMeta();
        })
        .catch(() => {});
    };
    listeners.add(onInvalidate);
    return () => {
      listeners.delete(onInvalidate);
    };
  }, [syncMeta]);

  const search = useCallback(
    (query: string, limit = 50) => searchCustomerEntries(entries, query, limit),
    [entries]
  );

  const refresh = useCallback(async () => {
    const data = await loadIndex(true);
    setEntries(data);
    syncMeta();
    return data;
  }, [syncMeta]);

  return { entries, search, loading, error, refresh, stale, savedAt, load };
}
