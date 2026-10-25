"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLocalCopyBehind, useLocalDatabase, useLocalSyncStatus } from "@/lib/powersync/store";
import { peekResult, resultKey, watchResult } from "@/lib/powersync/local-results";
import { parseStoredResult, readStoredResultRaw, storedResultJson } from "@/lib/powersync/stored-results";
import { deviceCopyPending, setDeviceCopyPending } from "@/lib/powersync/device-pending";
import { withSentry } from "@/lib/sentry-lazy";
import { noteOffline } from "@/lib/pwa/offline-report";
import type { LocalCardKind, LocalCardViewer, LocalDashboardCards } from "@/lib/powersync/dashboard-local";

// One page part from the on-device copy (LOCAL_DATA_PAGES), worked out with
// the server's own loader (lib/powersync/dashboard-local.ts). Kept and kept
// current by lib/powersync/local-results.ts: a part this device has worked out
// before (opened earlier, or prepared in the background) shows at once, and
// updates by itself whenever a table it reads changes. Right after the app
// opens — before the device database is ready — the last result stored on the
// device shows meanwhile (lib/powersync/stored-results.ts).
//
// If this device's copy can't serve it — not downloaded yet, the sync rules
// not deployed, or an error — the page reloads as the server version
// (`serverHref`, e.g. /dashboard?data=server), the way it worked before. A
// copy known to be incomplete (its first download hasn't finished) goes there
// at once, and the device remembers it so the server sends the server version
// straight away until the copy is complete (lib/powersync/device-pending.ts).

const FALLBACK_AFTER_MS = 8000;

/** Pages that fell back to the server version this session (reported once each). */
const fellBack = new Set<string>();

/** Said once a session: the device's copy isn't updating, so pages come from the server. */
let toldBehind = false;

/** Pages waiting for the connection to go to their server version (fallBackWhenOnline). */
const waitingForConnection = new Set<string>();

/**
 * No connection: the server version can't come either — asking for it only
 * reached the service worker's "not saved" (owner's test, 2026-10-25: the
 * sales tab's notice on the customers page). The page keeps what it shows,
 * says why, and goes to the server version once the connection is back — if
 * it's still the page on screen and the device still hasn't drawn it.
 */
function fallBackWhenOnline(
  router: ReturnType<typeof useRouter>,
  page: string,
  href: string,
  reason: string,
  error: unknown,
  stillNeeded: () => boolean
) {
  if (waitingForConnection.has(page)) return;
  waitingForConnection.add(page);
  noteOffline("device page failed", {
    pageKind: page,
    reason,
    message: error instanceof Error ? error.message.slice(0, 300) : undefined,
  });
  // Only slow, the device may still answer: nothing to say yet.
  if (reason !== "slow") toast.info("הדף לא נטען מהמכשיר — ייטען כשיחזור החיבור", { id: "device-page-offline" });
  const here = window.location.pathname;
  window.addEventListener(
    "online",
    () => {
      waitingForConnection.delete(page);
      if (window.location.pathname === here && stillNeeded()) router.replace(href);
    },
    { once: true }
  );
}

function fallBackToServer(
  router: ReturnType<typeof useRouter>,
  page: string,
  href: string,
  reason: string,
  error?: unknown,
  stillNeeded: () => boolean = () => true
) {
  if (!navigator.onLine) {
    fallBackWhenOnline(router, page, href, reason, error, stillNeeded);
    return;
  }
  if (reason === "not-synced") setDeviceCopyPending(true);
  if (reason === "behind" && !toldBehind) {
    toldBehind = true;
    toast.info("העותק במכשיר לא מתעדכן כרגע — הדפים מוצגים מהשרת", { id: "copy-behind" });
  }
  if (!fellBack.has(page)) {
    fellBack.add(page);
    withSentry((Sentry) =>
      Sentry.captureMessage(`PowerSync: ${page} fell back to the server version`, {
        // Behind: the connection's fault, not the copy's — not worth an email.
        level: reason === "behind" ? "info" : "warning",
        tags: { area: "powersync" },
        fingerprint: ["powersync", `${page}-fallback`, reason],
        extra: { reason },
      })
    );
  }
  router.replace(href);
}

/** Does the server answer now? A connection that hangs (a worker in the field) keeps the copy. */
async function serverAnswers(): Promise<boolean> {
  try {
    const res = await fetch("/api/ping", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

const neverChanges = () => () => {};

export type LocalCardResult<K extends LocalCardKind> = {
  data: LocalDashboardCards[K];
  /** The filters it was worked out for (JSON) — the previous ones for a moment after they change. */
  filtersKey: string;
  /**
   * Where it came from: worked out now by the device, kept from earlier
   * (opened before, or prepared in the background), stored on the device
   * last time (the app just opened), or the previous filters' result.
   */
  source: "device" | "kept" | "stored" | "previous";
  /** How long the device took to work it out (source "device"). */
  computeMs?: number;
};

export function useLocalCard<K extends LocalCardKind>({
  kind,
  viewer,
  filters,
  page,
  serverHref,
  storedMaxAgeMs,
}: {
  kind: K;
  viewer: LocalCardViewer;
  /** The list's filters (projects list, sales tabs, tasks board). */
  filters?: unknown;
  /** Which page this is, for the fallback report ("dashboard", "tasks"). */
  page: string;
  /** The server version of this page, for the fallback. */
  serverHref: string;
  /** How old the stored result may be and still show meanwhile — LIST_STORED_MAX_AGE_MS for lists (a day if not said). */
  storedMaxAgeMs?: number;
}): LocalCardResult<K> | null {
  const router = useRouter();
  const db = useLocalDatabase();
  const status = useLocalSyncStatus();
  const ready = Boolean(db && status?.hasSynced);
  const filtersKey = JSON.stringify(filters ?? null);
  const key = resultKey({ kind, viewer, filters });

  // The last result the device worked out (this kind only — another list's
  // data never stands in for this one).
  const [result, setResult] = useState<(LocalCardResult<K> & { key: string; kind: K }) | null>(() => {
    const kept = peekResult(db, key);
    return kept ? { data: kept.data as LocalDashboardCards[K], filtersKey, key, kind, source: "kept" } : null;
  });
  // For exactly this part: the device's result, or what it already holds for it.
  const keptNow = result?.key === key ? null : peekResult(db, key);
  const current: LocalCardResult<K> | null =
    result?.key === key
      ? result
      : keptNow
        ? { data: keptNow.data as LocalDashboardCards[K], filtersKey, source: "kept" }
        : null;
  // Before the device has it (the app just opened): the copy stored on the
  // device last time. Read on the client only, so the server's HTML matches.
  const storedRaw = useSyncExternalStore(neverChanges, () => readStoredResultRaw(key, storedMaxAgeMs), () => null);
  const stored = useMemo(() => parseStoredResult(storedRaw), [storedRaw]);
  // Read by the watch below without restarting it when the stored copy changes.
  const storedRef = useRef({ raw: storedRaw, parsed: stored });
  useEffect(() => {
    storedRef.current = { raw: storedRaw, parsed: stored };
  }, [storedRaw, stored]);
  const shown: LocalCardResult<K> | null =
    current ??
    (stored ? { data: stored.data as LocalDashboardCards[K], filtersKey, source: "stored" } : null) ??
    // Other filters, same list: the previous result for a moment (callers can narrow it).
    (result?.kind === kind ? { ...result, source: "previous" } : null);

  // Read through a ref: a change of URL that isn't a change of filters
  // (?task=…) mustn't start the work over.
  const serverHrefRef = useRef(serverHref);
  useEffect(() => {
    serverHrefRef.current = serverHref;
  }, [serverHref]);

  // The device hasn't answered for this part in time → the server version
  // (even with a stored copy on screen). A copy known to be incomplete — its
  // own status, or (before it has opened) the device's note of it — goes
  // there at once; so does a page that already fell back this session while
  // the copy still isn't ready. With no connection the device's note isn't
  // acted on before the copy itself says: it may have been written while the
  // sync was blocked, and the copy is all there is now.
  const answered = current !== null;
  const answeredRef = useRef(answered);
  useEffect(() => {
    answeredRef.current = answered;
  }, [answered]);
  const statusKnown = status !== null;
  const copyIncomplete = statusKnown && !status.hasSynced;
  useEffect(() => {
    if (answered) return;
    if (copyIncomplete || (!statusKnown && navigator.onLine && deviceCopyPending())) {
      fallBackToServer(router, page, serverHrefRef.current, "not-synced");
      return;
    }
    if (fellBack.has(page) && !ready && navigator.onLine) {
      router.replace(serverHrefRef.current);
      return;
    }
    const timer = setTimeout(
      () =>
        fallBackToServer(router, page, serverHrefRef.current, ready ? "slow" : "not-synced", undefined, () => !answeredRef.current),
      FALLBACK_AFTER_MS
    );
    return () => clearTimeout(timer);
  }, [answered, ready, copyIncomplete, statusKnown, router, page]);

  // Online, but the copy's sync has been down a while: the copy is missing
  // whatever changed since — a new order showed on the phone but not in the
  // office computer's orders list (owner, 2026-10-12). The server version,
  // once the server answers; with no answer the copy is still the best there is.
  const behind = useLocalCopyBehind();
  useEffect(() => {
    if (!behind) return;
    let cancelled = false;
    void serverAnswers().then((ok) => {
      if (ok && !cancelled) fallBackToServer(router, page, serverHrefRef.current, "behind");
    });
    return () => {
      cancelled = true;
    };
  }, [behind, router, page]);

  const { userId, role, locale } = viewer;
  useEffect(() => {
    if (!db || !ready) return;
    const cardFilters: unknown = JSON.parse(filtersKey) ?? undefined;
    return watchResult(
      db,
      { kind, viewer: { userId, role, locale }, filters: cardFilters },
      {
        onData: (data, json, computeMs) =>
          setResult((prev) => {
            // Handed the same result again: keep it, so nothing redraws.
            if (prev?.key === key && prev.data === data) return prev;
            // The first answer equals the stored copy on screen: keep that copy.
            const copy = storedRef.current;
            const same = prev?.key !== key && copy.parsed !== null && storedResultJson(copy.raw) === json;
            return {
              data: (same ? copy.parsed?.data : data) as LocalDashboardCards[K],
              filtersKey,
              key,
              kind,
              source: "device",
              computeMs,
            };
          }),
        onError: (reason, error) => {
          if (reason === "error") {
            withSentry((Sentry) =>
              Sentry.captureException(error, { tags: { area: "powersync", local_card: kind }, fingerprint: ["powersync", "local-card", kind] })
            );
          }
          fallBackToServer(router, page, serverHrefRef.current, reason, error);
        },
      }
    );
  }, [db, ready, kind, userId, role, locale, filtersKey, key, router, page]);

  return shown;
}
