"use client";

import { useEffect, useLayoutEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { useSettled } from "@/hooks/useSettled";
import { emitNavigationContentShown } from "@/components/layout/TopNavigationProgress";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import type { UserRole } from "@/lib/auth/requireProfile";
import { mergePropertyPage, type PropertyServerParts } from "@/lib/properties";
import PropertyPageSkeleton, { PropertyDetailBodySkeleton } from "./PropertyPageSkeleton";

const PropertyDetailClient = dynamic(() => import("./PropertyDetailClient"), {
  loading: () => <PropertyDetailBodySkeleton />,
});

// A property's page drawn from the on-device copy (LOCAL_DATA_PAGES.propertyPage):
// the property, its leases and rent, its money, shifts and tasks — the core,
// worked out with the server's own read (loadPropertyPageCore) on the device,
// and again by itself whenever any of it changes. What only the server reads
// (`serverParts`: the documents and files with their links, the leases'
// signed agreements, the recurring bills) follows from the server and fills in
// when it arrives — with no signal, the page shows without it. A property
// this device's copy doesn't hold yet (added a moment ago elsewhere) waits a
// little for it, then the server version.

/** How long a property missing from the copy is waited for before the server version. */
const MISSING_PROPERTY_WAIT_MS = 2500;

export default function LocalPropertyPage({
  id,
  viewer,
  serverParts,
  currentUserRole,
}: {
  id: string;
  viewer: LocalCardViewer;
  serverParts: Promise<PropertyServerParts>;
  currentUserRole: UserRole;
}) {
  const router = useRouter();
  const serverHref = `/properties/${encodeURIComponent(id)}?data=server`;
  const card = useLocalCard({ kind: "propertyPage", viewer, filters: { id }, page: "propertyPage", serverHref });
  // Another property's page for a moment (the previous result) never stands in.
  const shown = card && card.data.filters.id === id ? card : null;
  const missing = shown !== null && shown.data.core === null;
  useDevicePageTiming("property", missing ? null : shown, shown?.data.core?.activity.payments.length);
  const parts = useSettled(serverParts, id);

  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => router.replace(serverHref), MISSING_PROPERTY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [missing, router, serverHref]);

  // On screen with its content: the top bar is done (it would otherwise run on
  // until the server's answer for the page arrives behind it).
  const contentOnScreen = shown !== null && !missing;
  useLayoutEffect(() => {
    if (contentOnScreen) emitNavigationContentShown();
  }, [contentOnScreen]);

  const core = shown?.data.core ?? null;
  const page = useMemo(() => (core ? mergePropertyPage(core, parts) : null), [core, parts]);
  if (!core || !page) return <PropertyPageSkeleton routeLoading />;

  return (
    <PropertyDetailClient
      propertyId={id}
      property={page.property}
      activity={page.activity}
      users={core.users}
      salaryAgreements={core.salaryAgreements}
      currentUserId={viewer.userId}
      currentUserRole={currentUserRole}
      serverPartsReady={parts !== null}
    />
  );
}
