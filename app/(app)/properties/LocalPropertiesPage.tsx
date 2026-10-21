"use client";

import { useLayoutEffect } from "react";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { emitNavigationContentShown } from "@/components/layout/TopNavigationProgress";
import { LIST_STORED_MAX_AGE_MS } from "@/lib/powersync/stored-results";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import PropertiesSkeleton from "@/app/(app)/properties/PropertiesSkeleton";
import PropertiesClient from "@/app/(app)/properties/PropertiesClient";

// The /properties list drawn from the on-device copy (LOCAL_DATA_PAGES.properties):
// every property with who rents it, this period's rent and its money, worked
// out with the server's own loader (loadProperties) on the device — again by
// itself whenever a property, lease, payment, expense or shift changes. If the
// device's copy can't serve it, the page reloads as the server version
// (?data=server).

export default function LocalPropertiesPage({ viewer }: { viewer: LocalCardViewer }) {
  const list = useLocalCard({
    kind: "propertiesList",
    viewer,
    page: "properties",
    serverHref: "/properties?data=server",
    storedMaxAgeMs: LIST_STORED_MAX_AGE_MS,
  });
  useDevicePageTiming("properties", list, list?.data.properties.length);

  // On screen with its content: the top bar is done.
  const contentOnScreen = list !== null;
  useLayoutEffect(() => {
    if (contentOnScreen) emitNavigationContentShown();
  }, [contentOnScreen]);

  if (!list)
    return (
      <div className="space-y-4">
        <PropertiesSkeleton />
      </div>
    );
  return <PropertiesClient properties={list.data.properties} />;
}
