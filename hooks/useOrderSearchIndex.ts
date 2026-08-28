"use client";

import { useCallback, useEffect, useState } from "react";
import { customerMatchesQuery, fuzzyTextMatch, normalizeSearchText } from "@/lib/search/customerMatch";
import { loadOrderSearchIndex } from "@/app/(app)/sales/actions";
import type { OrderSearchIndexEntry } from "@/app/(app)/sales/loadOrders";
import type { CustomerSearchIndexEntry } from "./useCustomerSearchIndex";
import { loadSnapshot, saveSnapshot } from "@/lib/offline-cache";

export type { OrderSearchIndexEntry };

const TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_KEY = "order-search-index";

// Module-level cache shared by every consumer so the whole order list is
// fetched once per session, not per component — same pattern as
// useCustomerSearchIndex / useProjectSearchIndex.
let cache: { data: OrderSearchIndexEntry[]; loadedAt: number; stale: boolean } | null = null;
let inflight: Promise<OrderSearchIndexEntry[]> | null = null;
const listeners = new Set<() => void>();

async function loadIndex(force = false): Promise<OrderSearchIndexEntry[]> {
  if (!force && cache && !cache.stale && Date.now() - cache.loadedAt < TTL_MS) return cache.data;
  if (!force && inflight) return inflight;
  inflight = loadOrderSearchIndex()
    .then(({ orders }) => {
      cache = { data: orders, loadedAt: Date.now(), stale: false };
      void saveSnapshot(SNAPSHOT_KEY, orders);
      return orders;
    })
    .catch(async (err) => {
      const snap = await loadSnapshot<OrderSearchIndexEntry[]>(SNAPSHOT_KEY);
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

/** Drop the cached index and reload any mounted consumers (call after an order is created/edited). */
export function invalidateOrderSearchIndex() {
  cache = null;
  listeners.forEach((notify) => notify());
}

/**
 * Filter the index in memory: matches the order's customer (via the shared
 * customer matcher — fuzzy names, phone↔whatsapp cross-match) or its branch
 * name. Deep content matches (order notes, line-item product/notes) aren't
 * covered here — see findOrderContentMatches, merged in separately.
 */
export function searchOrderEntries(
  entries: OrderSearchIndexEntry[],
  query: string,
  customerEntries: CustomerSearchIndexEntry[],
  limit = 100
): OrderSearchIndexEntry[] {
  const q = query.trim();
  if (!q) return entries.slice(0, limit);

  const matchedCustomerIds = new Set(
    customerEntries.filter((c) => customerMatchesQuery(c, q)).map((c) => c.id)
  );

  const matched = entries.filter(
    (entry) => matchedCustomerIds.has(entry.customer_id) || fuzzyTextMatch(entry.customer_branch_name, q)
  );

  matched.sort((left, right) => {
    const scoreLeft = orderMatchScore(left, q, matchedCustomerIds);
    const scoreRight = orderMatchScore(right, q, matchedCustomerIds);
    if (scoreLeft !== scoreRight) return scoreLeft - scoreRight;
    return (right.order_date ?? "").localeCompare(left.order_date ?? "");
  });
  return matched.slice(0, limit);
}

function orderMatchScore(entry: OrderSearchIndexEntry, query: string, matchedCustomerIds: Set<string>): number {
  const nq = normalizeSearchText(query);
  const name = normalizeSearchText(entry.customer_name);
  if (name === nq) return 0;
  if (name.startsWith(nq)) return 1;
  if (name.includes(nq)) return 2;
  if (matchedCustomerIds.has(entry.customer_id)) return 3;
  return 4;
}

/**
 * Order search index: loads every order (lightweight) once, caches it
 * module-wide, and searches it in memory so order type-ahead is instant — no
 * per-keystroke network round-trip. Combine with useCustomerSearchIndex (pass
 * its entries in) so customer name/phone matches resolve too.
 */
export function useOrderSearchIndex() {
  const [entries, setEntries] = useState<OrderSearchIndexEntry[]>(cache?.data ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadIndex()
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("שגיאת טעינת רשימת ההזמנות");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onInvalidate = () => {
      loadIndex(true)
        .then((data) => setEntries(data))
        .catch(() => {});
    };
    listeners.add(onInvalidate);
    return () => {
      listeners.delete(onInvalidate);
    };
  }, []);

  const search = useCallback(
    (query: string, customerEntries: CustomerSearchIndexEntry[], limit = 100) =>
      searchOrderEntries(entries, query, customerEntries, limit),
    [entries]
  );

  return { entries, search, loading, error };
}
