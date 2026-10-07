"use client";

import { useEffect, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { useSettled } from "@/hooks/useSettled";
import { emitNavigationContentShown } from "@/components/layout/TopNavigationProgress";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import type { LedgerPrefs } from "@/lib/projectLedgerPrefs";
import ProjectPagePreview from "@/app/(app)/projects/[id]/ProjectPagePreview";
import ProjectPageView from "@/app/(app)/projects/[id]/ProjectPageView";
import type { ProjectPreview } from "@/app/(app)/projects/[id]/projectPreview";
import type { ProjectPageExtras } from "@/app/(app)/projects/[id]/loadProjectPageExtras";

// A project's page drawn from the on-device copy (LOCAL_DATA_PAGES.projectPage):
// the project, its money, tasks and movements — worked out with the server's
// own loader (lib/projects/project-page.ts) on the device, and again by itself
// whenever any of it changes. What only the server reads (its documents and
// every row's files, Morning documents, the change log, the history) follows
// from the server (`extras`) and fills in when it arrives.
//
// Drawn three ways, all from the same kept result: over the projects list the
// moment a row is tapped (RouteOpeningOverlay), as the page's loading screen,
// and as the page itself. A project this device's copy doesn't hold yet (made
// a moment ago elsewhere) waits a little for it, then the server version.

/** How long a project missing from the copy is waited for before the server version. */
const MISSING_PROJECT_WAIT_MS = 2500;

const LEDGER_PREFS_KEY = "bizh-ledger-prefs";

/** The person's תנועות view, as the server last gave it — for the page drawn before the server's answer. */
export function rememberedLedgerPrefs(userId: string): LedgerPrefs | null {
  try {
    const raw = localStorage.getItem(LEDGER_PREFS_KEY);
    const saved = raw ? (JSON.parse(raw) as { u?: string; p?: LedgerPrefs }) : null;
    return saved?.u === userId && saved.p ? saved.p : null;
  } catch {
    return null;
  }
}

function rememberLedgerPrefs(userId: string, prefs: LedgerPrefs) {
  try {
    localStorage.setItem(LEDGER_PREFS_KEY, JSON.stringify({ u: userId, p: prefs }));
  } catch {
    // Storage blocked: the opening just uses the default view.
  }
}

export default function LocalProjectPage({
  id,
  viewer,
  extras,
  preview = null,
}: {
  id: string;
  viewer: LocalCardViewer & { ledgerPrefs: LedgerPrefs };
  /** The parts only the server reads — null before the page has arrived (on a tap, the loading screen). */
  extras: PromiseLike<ProjectPageExtras> | null;
  /** What the projects list knew about it, shown until the device has worked it out. */
  preview?: ProjectPreview | null;
}) {
  const router = useRouter();
  const serverHref = `/projects/${encodeURIComponent(id)}?data=server`;
  const { userId, role, locale, ledgerPrefs } = viewer;
  const card = useLocalCard({
    kind: "projectPage",
    viewer: { userId, role, locale },
    filters: { id },
    page: "projectPage",
    serverHref,
  });
  // Another project's page for a moment (the previous result) never stands in.
  const shown = card && card.data.filters.id === id ? card : null;
  const missing = shown !== null && shown.data.dashboardRow === null;
  useDevicePageTiming("project", missing ? null : shown, shown?.data.expenses.length);
  const settledExtras = useSettled(extras, id);

  // Only the page itself carries the server's copy of the person's view.
  const fromServer = extras !== null;
  useEffect(() => {
    if (fromServer) rememberLedgerPrefs(userId, ledgerPrefs);
  }, [fromServer, userId, ledgerPrefs]);

  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => router.replace(serverHref), MISSING_PROJECT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [missing, router, serverHref]);

  // On screen with its content: the top bar is done (it would otherwise run on
  // until the server's answer for the page arrives behind it).
  const contentOnScreen = shown !== null && !missing;
  useLayoutEffect(() => {
    if (contentOnScreen) emitNavigationContentShown();
  }, [contentOnScreen]);

  if (!shown || missing) return preview ? <ProjectPagePreview preview={preview} routeLoading /> : <DetailPageSkeleton />;

  return <ProjectPageView id={id} core={shown.data} extras={settledExtras} viewer={{ role, ledgerPrefs }} />;
}
