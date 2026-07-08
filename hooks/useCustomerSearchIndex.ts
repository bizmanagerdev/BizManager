"use client";

import { useCallback, useEffect, useState } from "react";
import {
  customerMatchScore,
  customerMatchesQuery,
  normalizeSearchText,
  type CustomerSearchFields,
} from "@/lib/search/customerMatch";
import { loadCustomerSearchIndex } from "@/app/(app)/customers/actions";
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
  inflight = loadCustomerSearchIndex()
    .then(({ customers }) => {
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
export function useCustomerSearchIndex() {
  const [entries, setEntries] = useState<CustomerSearchIndexEntry[]>(cache?.data ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<boolean>(cache?.stale ?? false);
  const [savedAt, setSavedAt] = useState<number | null>(cache?.loadedAt ?? null);

  const syncMeta = useCallback(() => {
    const meta = getCustomerIndexMeta();
    setStale(meta.stale);
    setSavedAt(meta.savedAt);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // loadIndex resolves instantly from the module cache when it is warm, so
    // this paints synchronously-ish without a network round-trip; only the
    // first cold load actually hits the server (or the offline snapshot).
    loadIndex()
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setLoading(false);
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
  }, [syncMeta]);

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

  return { entries, search, loading, error, refresh, stale, savedAt };
}
