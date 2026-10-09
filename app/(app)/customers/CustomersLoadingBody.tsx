"use client";

import { usePathname } from "next/navigation";
import CustomerPageSkeleton from "@/app/(app)/customers/[id]/CustomerPageSkeleton";
import CustomersSkeleton, { CustomersStripSkeleton } from "@/app/(app)/customers/CustomersSkeleton";

// The customers list's loading screen is also what the router shows on the way
// from outside /customers to a customer's page (its boundary is the outer one),
// so it looks at the address: a customer's page — that page's own shape, and no
// strip (the page has none); the list — its shape, with the phone strip held
// open with its search / filter / export row, so the list arriving doesn't
// push the page down.
export default function CustomersLoadingBody() {
  const pathname = usePathname() ?? "/customers";
  if (pathname.startsWith("/customers/")) return <CustomerPageSkeleton routeLoading />;
  return (
    <>
      <CustomersStripSkeleton />
      <div className="space-y-4" data-route-loading="true">
        <CustomersSkeleton />
      </div>
    </>
  );
}
