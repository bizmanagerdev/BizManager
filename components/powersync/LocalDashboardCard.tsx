"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TodayScheduleCard from "@/components/dashboard/TodayScheduleCard";
import TodayAlertsCard from "@/components/dashboard/TodayAlertsCard";
import MyTasksPanel from "@/components/dashboard/MyTasksPanel";
import UpcomingDeliveries from "@/components/dashboard/UpcomingDeliveries";
import AttendanceApprovals from "@/components/dashboard/AttendanceApprovals";
import PropertiesCard from "@/components/dashboard/PropertiesCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalDatabase, useLocalSyncStatus } from "@/lib/powersync/store";
import { withSentry } from "@/lib/sentry-lazy";
import type { CommonPowerSyncDatabase } from "@powersync/web";
import type { LocalCardKind, LocalCardViewer, LocalDashboardCards } from "@/lib/powersync/dashboard-local";
import { cn } from "@/lib/utils";

// One dashboard card drawn from the on-device copy (LOCAL_DATA_PAGES.dashboard):
// worked out with the server's own loader (lib/powersync/dashboard-local.ts),
// then again whenever a table it reads changes — so it updates by itself,
// without a page refresh. Same card component the server version renders.
//
// If this device's copy can't serve the board — not downloaded yet, the sync
// rules not deployed, or an error — the page reloads as the server version
// (/dashboard?data=server), the way it worked before.

const FALLBACK_AFTER_MS = 8000;

let fellBack = false;
function fallBackToServer(router: ReturnType<typeof useRouter>, reason: string) {
  if (fellBack) return;
  fellBack = true;
  withSentry((Sentry) =>
    Sentry.captureMessage("PowerSync: dashboard fell back to the server version", {
      level: "warning",
      tags: { area: "powersync" },
      fingerprint: ["powersync", "dashboard-fallback", reason],
      extra: { reason },
    })
  );
  router.replace("/dashboard?data=server");
}

/** Has the device copy got the dashboard's tables (rules deployed)? Asked once per page load. */
let hasPeople: Promise<boolean> | null = null;
function deviceHasData(db: CommonPowerSyncDatabase): Promise<boolean> {
  hasPeople ??= db
    .get<{ n: number }>("SELECT count(*) AS n FROM users")
    .then((row) => row.n > 0)
    .catch(() => false);
  return hasPeople;
}

export default function LocalDashboardCard<K extends LocalCardKind>({
  kind,
  viewer,
  initialDate,
  canOpenOrder = false,
  fillClassName,
}: {
  kind: K;
  viewer: LocalCardViewer;
  /** todaySchedule: the server's date label for the first paint. */
  initialDate?: string;
  /** deliveries: whether a row opens the order (admin/office). */
  canOpenOrder?: boolean;
  /** The loading placeholder's sizing, matching the board's cells. */
  fillClassName?: string;
}) {
  const router = useRouter();
  const db = useLocalDatabase();
  const status = useLocalSyncStatus();
  const [data, setData] = useState<LocalDashboardCards[K] | null>(null);
  const ready = Boolean(db && status?.hasSynced);

  // Not ready in time → the server version.
  useEffect(() => {
    if (data !== null) return;
    const timer = setTimeout(() => fallBackToServer(router, ready ? "slow" : "not-synced"), FALLBACK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [data, ready, router]);

  useEffect(() => {
    if (!db || !ready) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      if (!(await deviceHasData(db))) return fallBackToServer(router, "no-data");
      const [{ computeLocalCard, LOCAL_CARD_TABLES }, { createLocalSupabase }] = await Promise.all([
        import("@/lib/powersync/dashboard-local"),
        import("@/lib/powersync/local-supabase"),
      ]);
      const local = createLocalSupabase(db);
      const recompute = async () => {
        try {
          const next = await computeLocalCard(local, kind, viewer);
          if (!cancelled) setData(next);
        } catch (error) {
          withSentry((Sentry) =>
            Sentry.captureException(error, { tags: { area: "powersync", local_card: kind }, fingerprint: ["powersync", "local-card", kind] })
          );
          if (!cancelled) fallBackToServer(router, "error");
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
  }, [db, ready, kind, viewer.userId, viewer.role, viewer.locale, router]);

  if (data === null) {
    return <Skeleton className={cn("h-16 w-full rounded-[1.125rem] xl:h-full", fillClassName)} />;
  }

  const { locale } = viewer;
  switch (kind) {
    case "todaySchedule":
      return (
        <TodayScheduleCard
          entries={data as LocalDashboardCards["todaySchedule"]}
          initialDate={initialDate ?? ""}
          locale={locale}
        />
      );
    case "todayAlerts":
      return <TodayAlertsCard alerts={(data as LocalDashboardCards["todayAlerts"]).alerts} locale={locale} />;
    case "myTasks":
      return <MyTasksPanel tasks={data as LocalDashboardCards["myTasks"]} locale={locale} />;
    case "deliveries": {
      const deliveries = data as LocalDashboardCards["deliveries"];
      return <UpcomingDeliveries deliveries={deliveries.items} spark={deliveries.spark} canOpenOrder={canOpenOrder} />;
    }
    case "attendanceQueue": {
      const queue = data as LocalDashboardCards["attendanceQueue"];
      return (
        <AttendanceApprovals
          data={queue.data}
          spark={queue.spark}
          projectOptions={queue.options?.projectOptions ?? []}
          propertyOptions={queue.options?.propertyOptions ?? []}
          locale={locale}
        />
      );
    }
    case "properties":
      return <PropertiesCard summary={data as LocalDashboardCards["properties"]} locale={locale} />;
    default:
      return null;
  }
}
