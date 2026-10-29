"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import { Card, CardContent } from "@/components/ui/card";
import PaymentsHubClient from "./PaymentsHubClient";
import PaymentsCalendarSkeleton from "./PaymentsCalendarSkeleton";
import { DeviceBoardData } from "./useRefreshAndWait";

// The payments calendar (צפי תזרים) drawn from the on-device copy
// (LOCAL_DATA_PAGES.paymentsCalendar; owner, 2026-10-29: "yes go ahead with
// 1-3"): the whole page — both directions, both tabs, the dialogs' lists —
// worked out with the server's own code (loadPaymentsCalendarView) on the
// device, again by itself whenever a table it reads changes. Its tab, month,
// direction and filters were already the page's own (in the address, read on
// the phone), so changing them asks nothing of anyone. Saves still go to the
// server and come back through the copy — the windows wait for that
// (DeviceBoardData). If the device's copy can't serve the page, it reloads as
// the server version (?data=server).

export default function LocalPaymentsCalendarPage({ viewer }: { viewer: LocalCardViewer }) {
  // The server version keeps the tab, month and direction on screen.
  const paramsKey = useSearchParams().toString();
  const serverHref = useMemo(() => {
    const next = new URLSearchParams(paramsKey);
    next.set("data", "server");
    return `/financial/payments-calendar?${next.toString()}`;
  }, [paramsKey]);
  const page = useLocalCard({ kind: "paymentsCalendar", viewer, page: "paymentsCalendar", serverHref });
  useDevicePageTiming("paymentsCalendar", page, page?.data.items.length);

  if (!page) return <PaymentsCalendarSkeleton />;
  const view = page.data;
  if (view.error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-4 text-sm text-destructive">{view.error}</CardContent>
      </Card>
    );
  }
  return (
    <DeviceBoardData.Provider value={view}>
      <PaymentsHubClient
        items={view.items}
        todayIso={view.todayIso}
        templates={view.templates}
        projects={view.projects}
        properties={view.properties}
        orders={view.orders}
        accounts={view.accounts}
        incomeOptions={view.incomeOptions}
        expenseMissingSchema={view.expenseMissingSchema}
      />
    </DeviceBoardData.Provider>
  );
}
