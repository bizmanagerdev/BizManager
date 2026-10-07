"use client";

import TodayScheduleCard from "@/components/dashboard/TodayScheduleCard";
import TodayAlertsCard from "@/components/dashboard/TodayAlertsCard";
import MyTasksPanel from "@/components/dashboard/MyTasksPanel";
import UpcomingDeliveries from "@/components/dashboard/UpcomingDeliveries";
import AttendanceApprovals from "@/components/dashboard/AttendanceApprovals";
import PropertiesCard from "@/components/dashboard/PropertiesCard";
import UpcomingPayments from "@/components/dashboard/UpcomingPayments";
import CollectionsCard from "@/components/dashboard/CollectionsCard";
import DomainChartCard from "@/components/dashboard/DomainChartCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import type { LocalCardKind, LocalCardViewer, LocalDashboardCards } from "@/lib/powersync/dashboard-local";
import { cn } from "@/lib/utils";

// One dashboard card drawn from the on-device copy (LOCAL_DATA_PAGES.dashboard):
// worked out with the server's own loader and kept up to date by itself
// (useLocalCard). Same card component the server version renders. If the
// device's copy can't serve the board, the page reloads as the server version
// (/dashboard?data=server).

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
  const result = useLocalCard({ kind, viewer, page: "dashboard", serverHref: "/dashboard?data=server" });
  useDevicePageTiming(`dashboard:${kind}`, result);
  // No answer yet: the placeholder. (An answer can itself be null — the money
  // chart when nothing moved this month — and then there's no card.)
  if (!result) {
    // As tall as this card last stood on this device (the cell's --held-h).
    return <Skeleton className={cn("h-[var(--held-h,4rem)] w-full rounded-[1.125rem] xl:h-full", fillClassName)} />;
  }

  const { data } = result;
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
    case "payments":
      return <UpcomingPayments summary={data as LocalDashboardCards["payments"]} locale={locale} />;
    case "collections":
      return <CollectionsCard summary={data as LocalDashboardCards["collections"]} locale={locale} />;
    case "domainChart": {
      const chart = data as LocalDashboardCards["domainChart"];
      return chart ? <DomainChartCard {...chart} locale={locale} /> : null;
    }
    default:
      return null;
  }
}
