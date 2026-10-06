"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocalDatabase, useLocalSyncStatus } from "@/lib/powersync/store";
import { peekResult, resultKey, watchResult } from "@/lib/powersync/local-results";
import { withSentry } from "@/lib/sentry-lazy";
import type { LocalCardKind, LocalCardViewer, LocalDashboardCards } from "@/lib/powersync/dashboard-local";

// One page part from the on-device copy (LOCAL_DATA_PAGES), worked out with
// the server's own loader (lib/powersync/dashboard-local.ts). Kept and kept
// current by lib/powersync/local-results.ts: a part this device has worked out
// before (opened earlier, or prepared in the background) shows at once, and
// updates by itself whenever a table it reads changes.
//
// If this device's copy can't serve it — not downloaded yet, the sync rules
// not deployed, or an error — the page reloads as the server version
// (`serverHref`, e.g. /dashboard?data=server), the way it worked before.

const FALLBACK_AFTER_MS = 8000;

/** Pages that fell back to the server version this session (reported once each). */
const fellBack = new Set<string>();

function fallBackToServer(router: ReturnType<typeof useRouter>, page: string, href: string, reason: string) {
  if (!fellBack.has(page)) {
    fellBack.add(page);
    withSentry((Sentry) =>
      Sentry.captureMessage(`PowerSync: ${page} fell back to the server version`, {
        level: "warning",
        tags: { area: "powersync" },
        fingerprint: ["powersync", `${page}-fallback`, reason],
        extra: { reason },
      })
    );
  }
  router.replace(href);
}

export type LocalCardResult<K extends LocalCardKind> = {
  data: LocalDashboardCards[K];
  /** The filters it was worked out for (JSON) — the previous ones for a moment after they change. */
  filtersKey: string;
};

export function useLocalCard<K extends LocalCardKind>({
  kind,
  viewer,
  filters,
  page,
  serverHref,
}: {
  kind: K;
  viewer: LocalCardViewer;
  /** The list's filters (projects list, sales tabs, tasks board). */
  filters?: unknown;
  /** Which page this is, for the fallback report ("dashboard", "tasks"). */
  page: string;
  /** The server version of this page, for the fallback. */
  serverHref: string;
}): LocalCardResult<K> | null {
  const router = useRouter();
  const db = useLocalDatabase();
  const status = useLocalSyncStatus();
  const ready = Boolean(db && status?.hasSynced);
  const filtersKey = JSON.stringify(filters ?? null);
  const key = resultKey({ kind, viewer, filters });

  // What this device already holds for it shows on the very first paint.
  const [result, setResult] = useState<LocalCardResult<K> | null>(() => {
    const kept = peekResult(db, key);
    return kept ? { data: kept.data as LocalDashboardCards[K], filtersKey } : null;
  });
  // Other filters than the result held: the kept result for them, if any —
  // otherwise the previous one for a moment (callers can narrow it).
  const kept = result?.filtersKey === filtersKey ? null : peekResult(db, key);
  const shown: LocalCardResult<K> | null = kept ? { data: kept.data as LocalDashboardCards[K], filtersKey } : result;

  // Read through a ref: a change of URL that isn't a change of filters
  // (?task=…) mustn't start the work over.
  const serverHrefRef = useRef(serverHref);
  useEffect(() => {
    serverHrefRef.current = serverHref;
  }, [serverHref]);

  // Not ready in time → the server version. A page that already fell back
  // this session goes straight there while the copy still isn't ready.
  const showing = shown !== null;
  useEffect(() => {
    if (showing) return;
    if (fellBack.has(page) && !ready) {
      router.replace(serverHrefRef.current);
      return;
    }
    const timer = setTimeout(
      () => fallBackToServer(router, page, serverHrefRef.current, ready ? "slow" : "not-synced"),
      FALLBACK_AFTER_MS
    );
    return () => clearTimeout(timer);
  }, [showing, ready, router, page]);

  const { userId, role, locale } = viewer;
  useEffect(() => {
    if (!db || !ready) return;
    const cardFilters: unknown = JSON.parse(filtersKey) ?? undefined;
    return watchResult(
      db,
      { kind, viewer: { userId, role, locale }, filters: cardFilters },
      {
        onData: (data) => setResult({ data: data as LocalDashboardCards[K], filtersKey }),
        onError: (reason, error) => {
          if (reason === "error") {
            withSentry((Sentry) =>
              Sentry.captureException(error, { tags: { area: "powersync", local_card: kind }, fingerprint: ["powersync", "local-card", kind] })
            );
          }
          fallBackToServer(router, page, serverHrefRef.current, reason);
        },
      }
    );
  }, [db, ready, kind, userId, role, locale, filtersKey, router, page]);

  return shown;
}
