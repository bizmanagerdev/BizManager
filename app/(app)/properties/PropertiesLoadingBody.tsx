"use client";

import { usePathname } from "next/navigation";
import PropertyPageSkeleton from "@/app/(app)/properties/[id]/PropertyPageSkeleton";
import PropertiesSkeleton from "@/app/(app)/properties/PropertiesSkeleton";

// The properties list's loading screen is also what the router shows on the
// way from outside /properties to a property's page (its boundary is the outer
// one), so it looks at the address: a property's page — that page's own shape;
// the list — its heading and cards.
export default function PropertiesLoadingBody() {
  const pathname = usePathname() ?? "/properties";
  if (pathname.startsWith("/properties/")) return <PropertyPageSkeleton routeLoading />;
  return (
    <div className="space-y-4" data-route-loading="true">
      <PropertiesSkeleton />
    </div>
  );
}
