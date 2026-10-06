"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocalDatabase, useLocalSyncStatus } from "@/lib/powersync/store";
import { withSentry } from "@/lib/sentry-lazy";
import type { CommonPowerSyncDatabase } from "@powersync/web";
import type { LocalCardKind, LocalCardViewer, LocalDashboardCards } from "@/lib/powersync/dashboard-local";

// One page part worked out from the on-device copy (LOCAL_DATA_PAGES): with
// the server's own loader (lib/powersync/dashboard-local.ts), then again
// whenever a table it reads changes — so it updates by itself, without a page
// refresh.
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

/** Has the device copy got data (rules deployed)? A yes is remembered for the page load. */
let hasPeople: Promise<boolean> | null = null;
function deviceHasData(db: CommonPowerSyncDatabase): Promise<boolean> {
  hasPeople ??= db
    .get<{ n: number }>("SELECT count(*) AS n FROM users")
    .then((row) => row.n > 0)
    .catch(() => false)
    .then((yes) => {
      if (!yes) hasPeople = null;
      return yes;
    });
  return hasPeople;
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
  const [result, setResult] = useState<LocalCardResult<K> | null>(null);
  const ready = Boolean(db && status?.hasSynced);
  const filtersKey = JSON.stringify(filters ?? null);

  // Read through a ref: a change of URL that isn't a change of filters
  // (?task=…) mustn't start the work over.
  const serverHrefRef = useRef(serverHref);
  useEffect(() => {
    serverHrefRef.current = serverHref;
  }, [serverHref]);

  // Not ready in time → the server version. A page that already fell back
  // this session goes straight there while the copy still isn't ready.
  useEffect(() => {
    if (result !== null) return;
    if (fellBack.has(page) && !ready) {
      router.replace(serverHrefRef.current);
      return;
    }
    const timer = setTimeout(
      () => fallBackToServer(router, page, serverHrefRef.current, ready ? "slow" : "not-synced"),
      FALLBACK_AFTER_MS
    );
    return () => clearTimeout(timer);
  }, [result, ready, router, page]);

  useEffect(() => {
    if (!db || !ready) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      if (!(await deviceHasData(db))) return fallBackToServer(router, page, serverHrefRef.current, "no-data");
      const [{ computeLocalCard, LOCAL_CARD_TABLES }, { createLocalSupabase }] = await Promise.all([
        import("@/lib/powersync/dashboard-local"),
        import("@/lib/powersync/local-supabase"),
      ]);
      const local = createLocalSupabase(db);
      const cardFilters: unknown = JSON.parse(filtersKey) ?? undefined;
      const recompute = async () => {
        try {
          const data = await computeLocalCard(local, kind, viewer, cardFilters);
          if (!cancelled) setResult({ data, filtersKey });
        } catch (error) {
          withSentry((Sentry) =>
            Sentry.captureException(error, { tags: { area: "powersync", local_card: kind }, fingerprint: ["powersync", "local-card", kind] })
          );
          if (!cancelled) fallBackToServer(router, page, serverHrefRef.current, "error");
        }
      };
      await recompute();
      if (cancelled) return;
      dispose = db.onChange({ onChange: () => void recompute() }, { tables: LOCAL_CARD_TABLES[kind], throttleMs: 300 });
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
    // viewer is a plain props object from the server — its fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, ready, kind, viewer.userId, viewer.role, viewer.locale, filtersKey, router, page]);

  return result;
}
