"use client";

import { usePathname } from "next/navigation";
import VehiclePageSkeleton from "@/app/(app)/vehicles/[id]/VehiclePageSkeleton";
import VehiclesSkeleton from "@/app/(app)/vehicles/VehiclesSkeleton";

// The vehicles list's loading screen is also what the router shows on the way
// from outside /vehicles to a vehicle's page (its boundary is the outer one),
// so it looks at the address: a vehicle's page — that page's own shape; the
// list — its cards.
export default function VehiclesLoadingBody() {
  const pathname = usePathname() ?? "/vehicles";
  if (pathname.startsWith("/vehicles/")) return <VehiclePageSkeleton routeLoading />;
  return (
    <div className="space-y-4" data-route-loading="true">
      <VehiclesSkeleton />
    </div>
  );
}
