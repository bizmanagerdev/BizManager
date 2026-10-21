"use client";

import { useLayoutEffect } from "react";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { emitNavigationContentShown } from "@/components/layout/TopNavigationProgress";
import { LIST_STORED_MAX_AGE_MS } from "@/lib/powersync/stored-results";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import RentRollSkeleton from "@/app/(app)/rent/RentRollSkeleton";
import RentRollClient from "@/app/(app)/rent/RentRollClient";

// The rent roll drawn from the on-device copy (LOCAL_DATA_PAGES.rentRoll):
// every lease and property income, read with the server's own loader
// (loadRentRoll) on the device — again by itself whenever a property, lease,
// tenant or payment changes. If the device's copy can't serve it, the page
// reloads as the server version (?data=server).

export default function LocalRentRollPage({ viewer }: { viewer: LocalCardViewer }) {
  const roll = useLocalCard({
    kind: "rentRoll",
    viewer,
    page: "rentRoll",
    serverHref: "/rent?data=server",
    storedMaxAgeMs: LIST_STORED_MAX_AGE_MS,
  });
  useDevicePageTiming("rentRoll", roll, roll?.data.data.leases.length);

  // On screen with its content: the top bar is done.
  const contentOnScreen = roll !== null;
  useLayoutEffect(() => {
    if (contentOnScreen) emitNavigationContentShown();
  }, [contentOnScreen]);

  if (!roll) return <RentRollSkeleton />;
  return <RentRollClient data={roll.data.data} />;
}
