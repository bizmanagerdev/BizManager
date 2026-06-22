"use client";

import { useCallback, useEffect, useState } from "react";
import {
  customerMatchScore,
  customerMatchesQuery,
  normalizeSearchText,
  type CustomerSearchFields,
} from "@/lib/search/customerMatch";
import { loadCustomerSearchIndex } from "@/app/customers/actions";
import type { CustomerSearchIndexEntry } from "@/app/customers/loadCustomers";

export type { CustomerSearchIndexEntry };

const TTL_MS = 5 * 60 * 1000;

// Module-level cache shared by every consumer so the whole customer list is
// fetched once per session, not per component.
let cache: { data: CustomerSearchIndexEntry[]; loadedAt: number } | null = null;
let inflight: Promise<CustomerSearchIndexEntry[]> | null = null;
const listeners = new Set<() => void>();

async function loadIndex(force = false): Promise<CustomerSearchIndexEntry[]> {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return cache.data;
  if (!force && inflight) return inflight;
  inflight = loadCustomerSearchIndex()
    .then(({ customers }) => {
      cache = { data: customers, loadedAt: Date.now() };
      return customers;
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

  useEffect(() => {
    let cancelled = false;
    // loadIndex resolves instantly from the module cache when it is warm, so
    // this paints synchronously-ish without a network round-trip; only the
    // first cold load actually hits the server.
    loadIndex()
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("שגיאת טעינת רשימת הלקוחות");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload when the index is invalidated (e.g. after a customer is created).
  useEffect(() => {
    const onInvalidate = () => {
      loadIndex(true)
        .then(setEntries)
        .catch(() => {});
    };
    listeners.add(onInvalidate);
    return () => {
      listeners.delete(onInvalidate);
    };
  }, []);

  const search = useCallback(
    (query: string, limit = 50) => searchCustomerEntries(entries, query, limit),
    [entries]
  );

  const refresh = useCallback(async () => {
    const data = await loadIndex(true);
    setEntries(data);
    return data;
  }, []);

  return { entries, search, loading, error, refresh };
}
