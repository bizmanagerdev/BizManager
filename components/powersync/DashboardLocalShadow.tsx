"use client";

import { useEffect, useRef } from "react";
import { useLocalDatabase, useLocalSyncStatus } from "@/lib/powersync/store";
import { withSentry } from "@/lib/sentry-lazy";
import type { DashboardShadowSnapshot, ShadowResult } from "@/lib/powersync/dashboard-shadow";

// Renders nothing. Once this device's copy is up to date (synced after the
// server read its figures), works the given dashboard cards out from the
// device copy and compares — see lib/powersync/dashboard-shadow.ts. The
// comparison code loads only here, only for the people the copy is on for.
//
// Reported to Sentry: each card that differs (once per card per day per
// device), and one daily summary per device with every card's result and how
// long the device took — the evidence for switching the board over.

const REPORTED_KEY = "bizh-powersync-shadow";

function alreadyReported(key: string): boolean {
  try {
    const raw = localStorage.getItem(REPORTED_KEY);
    const seen = raw ? (JSON.parse(raw) as Record<string, true>) : {};
    if (seen[key]) return true;
    const today = key.slice(0, 10);
    const kept = Object.fromEntries(Object.entries(seen).filter(([k]) => k.startsWith(today)));
    localStorage.setItem(REPORTED_KEY, JSON.stringify({ ...kept, [key]: true }));
    return false;
  } catch {
    return false;
  }
}

/** Has `key` been marked today (without marking it)? */
function wasReported(key: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(REPORTED_KEY) ?? "{}") as Record<string, boolean>;
    return Boolean(seen[key]);
  } catch {
    return false;
  }
}

function report(results: ShadowResult[]) {
  const day = new Date().toISOString().slice(0, 10);
  for (const result of results) {
    if (result.match || alreadyReported(`${day}:differs:${result.card}`)) continue;
    withSentry((Sentry) =>
      Sentry.captureMessage(`PowerSync shadow: ${result.card} differs from the server`, {
        level: "warning",
        tags: { area: "powersync", shadow_card: result.card },
        fingerprint: ["powersync-shadow", result.card],
        extra: { diffs: result.diffs, error: result.error, localMs: result.localMs },
      })
    );
  }
  const summaryKey = `${day}:summary:${results.map((r) => r.card).sort().join(",")}`;
  if (alreadyReported(summaryKey)) return;
  withSentry((Sentry) =>
    Sentry.captureMessage("PowerSync shadow check", {
      level: "info",
      tags: Object.fromEntries([["area", "powersync"], ...results.map((r) => [`shadow_${r.card}`, r.match ? "match" : "differs"])]),
      extra: Object.fromEntries(results.map((r) => [r.card, { match: r.match, localMs: r.localMs }])),
    })
  );
}

export default function DashboardLocalShadow({
  snapshot,
  checkMoneyViews = false,
}: {
  snapshot: DashboardShadowSnapshot;
  /** Also run the daily whole-money-views check (one instance per board). */
  checkMoneyViews?: boolean;
}) {
  const db = useLocalDatabase();
  const status = useLocalSyncStatus();
  const done = useRef(false);

  const fresh =
    status?.hasSynced === true &&
    status.lastSyncedAt !== null &&
    status.lastSyncedAt.getTime() >= Date.parse(snapshot.renderedAt);

  useEffect(() => {
    if (!db || !fresh || done.current) return;
    done.current = true;
    void (async () => {
      // No people on the device = the sync rules that carry the dashboard's
      // tables aren't deployed yet: nothing to compare against.
      const people = await db.get<{ n: number }>("SELECT count(*) AS n FROM users").catch(() => ({ n: 0 }));
      if (!people.n) return;
      const { runDashboardShadow, runMoneyViewsCheck } = await import("@/lib/powersync/dashboard-shadow");
      report(await runDashboardShadow(db, snapshot));
      // The money views are heavy to read whole: once a day per device. It
      // counts as done only once it has finished — leaving the page halfway
      // means it runs again next time.
      const moneyKey = `${new Date().toISOString().slice(0, 10)}:money-views-ran`;
      if (checkMoneyViews && !wasReported(moneyKey)) {
        const results = await runMoneyViewsCheck(db);
        alreadyReported(moneyKey);
        report(results);
      }
    })().catch((error) =>
      withSentry((Sentry) => Sentry.captureException(error, { tags: { area: "powersync" }, fingerprint: ["powersync-shadow", "crashed"] }))
    );
  }, [db, fresh, snapshot, checkMoneyViews]);

  return null;
}
