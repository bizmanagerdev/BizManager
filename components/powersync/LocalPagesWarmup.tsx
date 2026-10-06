"use client";

import { useEffect } from "react";
import { useLocalDatabase, useLocalSyncStatus } from "@/lib/powersync/store";
import { warmResults } from "@/lib/powersync/local-results";
import { usualPageViews } from "@/lib/powersync/warm-pages";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";

/**
 * Keeps the usual view of each device-version page ready in the background —
 * worked out in the phone's idle moments once the copy has synced, and again
 * when what it reads changes — so opening the page has nothing to wait for.
 * It reads the device's own copy only: no request reaches the server.
 */
export default function LocalPagesWarmup({ viewer }: { viewer: LocalCardViewer }) {
  const db = useLocalDatabase();
  const status = useLocalSyncStatus();
  const ready = Boolean(db && status?.hasSynced);
  const { userId, role, locale } = viewer;

  useEffect(() => {
    if (!db || !ready) return;
    const views = usualPageViews({ userId, role, locale });
    return views.length ? warmResults(db, views) : undefined;
  }, [db, ready, userId, role, locale]);

  return null;
}
