"use client";

import { useCallback, useEffect, useState } from "react";
import { fuzzyTextMatch, normalizeSearchText } from "@/lib/search/customerMatch";
import { projectTypesMatching } from "@/lib/search/projectTypeLabels";
import { loadProjectSearchIndex } from "@/app/(app)/projects/actions";
import type { ProjectSearchIndexEntry } from "@/app/(app)/projects/loadProjects";
import type { CustomerSearchIndexEntry } from "./useCustomerSearchIndex";
import { customerMatchesQuery } from "@/lib/search/customerMatch";
import { loadSnapshot, saveSnapshot } from "@/lib/offline-cache";

export type { ProjectSearchIndexEntry };

const TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_KEY = "project-search-index";

// Module-level cache shared by every consumer so the whole project list is
// fetched once per session, not per component — same pattern as
// useCustomerSearchIndex.
let cache: { data: ProjectSearchIndexEntry[]; loadedAt: number; stale: boolean } | null = null;
let inflight: Promise<ProjectSearchIndexEntry[]> | null = null;
const listeners = new Set<() => void>();

async function loadIndex(force = false): Promise<ProjectSearchIndexEntry[]> {
  if (!force && cache && !cache.stale && Date.now() - cache.loadedAt < TTL_MS) return cache.data;
  if (!force && inflight) return inflight;
  inflight = loadProjectSearchIndex()
    .then(({ projects }) => {
      cache = { data: projects, loadedAt: Date.now(), stale: false };
      void saveSnapshot(SNAPSHOT_KEY, projects);
      return projects;
    })
    .catch(async (err) => {
      const snap = await loadSnapshot<ProjectSearchIndexEntry[]>(SNAPSHOT_KEY);
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

/** Drop the cached index and reload any mounted consumers (call after a project is created/edited). */
export function invalidateProjectSearchIndex() {
  cache = null;
  listeners.forEach((notify) => notify());
}

/**
 * Filter the index in memory: matches the project's own name, its customer
 * (via the shared customer matcher — fuzzy names, phone↔whatsapp cross-match),
 * or the typed project-type Hebrew label. Deep content matches (task subject,
 * task comments, project notes) aren't covered here — see
 * findProjectContentMatches, merged in separately since it needs a query.
 */
export function searchProjectEntries(
  entries: ProjectSearchIndexEntry[],
  query: string,
  customerEntries: CustomerSearchIndexEntry[],
  limit = 100
): ProjectSearchIndexEntry[] {
  const q = query.trim();
  if (!q) return entries.slice(0, limit);

  const matchedCustomerIds = new Set(
    customerEntries.filter((c) => customerMatchesQuery(c, q)).map((c) => c.id)
  );
  const matchingTypes = new Set(projectTypesMatching(q));

  const matched = entries.filter(
    (entry) =>
      fuzzyTextMatch(entry.name, q) ||
      fuzzyTextMatch(entry.customer_name, q) ||
      matchedCustomerIds.has(entry.customer_id) ||
      matchingTypes.has(entry.project_type)
  );

  matched.sort((left, right) => {
    const scoreLeft = projectMatchScore(left, q, matchedCustomerIds);
    const scoreRight = projectMatchScore(right, q, matchedCustomerIds);
    if (scoreLeft !== scoreRight) return scoreLeft - scoreRight;
    return normalizeSearchText(left.name).localeCompare(normalizeSearchText(right.name), "he");
  });
  return matched.slice(0, limit);
}

function projectMatchScore(entry: ProjectSearchIndexEntry, query: string, matchedCustomerIds: Set<string>): number {
  const nq = normalizeSearchText(query);
  const name = normalizeSearchText(entry.name);
  if (name === nq) return 0;
  if (name.startsWith(nq)) return 1;
  if (name.includes(nq)) return 2;
  if (matchedCustomerIds.has(entry.customer_id)) return 3;
  return 4;
}

/**
 * Project search index: loads every project (lightweight) once, caches it
 * module-wide, and searches it in memory so project type-ahead is instant —
 * no per-keystroke network round-trip. Combine with useCustomerSearchIndex
 * (pass its entries in) so customer name/phone matches resolve too.
 */
export function useProjectSearchIndex() {
  const [entries, setEntries] = useState<ProjectSearchIndexEntry[]>(cache?.data ?? []);
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
        setError("שגיאת טעינת רשימת הפרויקטים");
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
      searchProjectEntries(entries, query, customerEntries, limit),
    [entries]
  );

  return { entries, search, loading, error };
}
