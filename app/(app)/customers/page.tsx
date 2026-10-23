import { Suspense } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withLoadedAt } from "@/lib/loaded-at";
import { loadCustomersPage } from "@/app/(app)/customers/loadCustomers";
import { parseCustomersFilters } from "@/app/(app)/customers/customersFilters";
import CustomersSkeleton, { CustomersStripSkeleton } from "@/app/(app)/customers/CustomersSkeleton";
import CustomersLoadError from "@/app/(app)/customers/CustomersLoadError";
import CustomersTitle from "@/app/(app)/customers/CustomersTitle";
import LocalCustomersPage from "@/app/(app)/customers/LocalCustomersPage";
import CustomersServerCheck from "@/app/(app)/customers/CustomersServerCheck";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW, localDataEnabledFor } from "@/lib/powersync/config";
import { israelDateKey } from "@/lib/timezone";

// While the list's code loads: the same placeholder as the loading screen, strip
// included, so the strip doesn't fold away and reopen in between.
const CustomersClient = dynamic(() => import("@/app/(app)/customers/CustomersClient"), {
  loading: () => (
    <>
      <CustomersTitle />
      <CustomersStripSkeleton />
      <CustomersSkeleton />
    </>
  ),
});

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{
    with_projects?: string;
    with_orders?: string;
    with_debt?: string;
    active_only?: string;
    data?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const filters = parseCustomersFilters((param) => {
    const value = params[param as keyof typeof params];
    return typeof value === "string" ? value : null;
  });

  // The list's read and the "who's asking" check go out together, as on the
  // projects and sales pages. The read runs under the caller's own RLS whatever
  // their role, and a caller who isn't staff is still redirected below before
  // anything is rendered — the check just no longer holds the list back.
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireStaffPage();
  // When the rows were read — the nav prefetches this page ahead of a click
  // and the browser may show that copy minutes later, so the list refreshes
  // its first page when it's older than a few seconds (useInfiniteScroll's
  // loadedAt).
  // With the device version on for everyone (LOCAL_DATA_PAGES.customers) the
  // read waits for the check instead, and goes out only for people without a
  // device copy — at once again for ?data=server, the device version's way back.
  const startRead = () => {
    const read = withLoadedAt(loadCustomersPage(supabase, { page: 1, filters }));
    // Awaited right after the check; this only keeps a failure that lands
    // first from being reported as unhandled meanwhile.
    read.catch(() => {});
    return read;
  };
  const earlyRead = LOCAL_DATA_PAGES.customers && params.data !== "server" ? null : startRead();

  const { profile } = await profilePromise;

  // The device version: the list worked out from this person's on-device copy
  // (LocalCustomersPage). ?data=server is the way back when the copy can't
  // serve it; a device whose copy is still incomplete gets the server version
  // at once.
  if (params.data !== "server" && (await devicePageOn("customers", profile))) {
    // Once a day per device, the server's own list too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.customers && (await deviceCheckDue("customers"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <div className="space-y-4">
          <DeviceFrameMark page="customers" renderedAt={serverRenderedAt()} />
          <LocalCustomersPage viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }} />
          {checkDue ? (
            <Suspense fallback={null}>
              <CustomersServerCheck
                supabase={supabase}
                filters={filters}
                userId={profile.id}
                role={profile.role ?? ""}
                locale={profile.locale}
              />
            </Suspense>
          ) : null}
        </div>
      </AppShell>
    );
  }

  const { rows, totalCount, hasMore, error: loadError, loadedAt } = await (earlyRead ?? startRead());

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        {/* The device-copy check for this list (lib/powersync/dashboard-shadow.ts):
            worked out on the device too, and compared. */}
        {LOCAL_DATA_SHADOW.customers && localDataEnabledFor(profile.role) && !loadError ? (
          <DashboardLocalShadow
            snapshot={{
              renderedAt: new Date(loadedAt).toISOString(),
              userId: profile.id,
              role: profile.role ?? "",
              locale: profile.locale,
              todayIso: israelDateKey(),
              cards: { customersList: { filters, rows, hasMore, totalCount } },
            }}
          />
        ) : null}
        {loadError ? (
          <CustomersLoadError message={loadError} />
        ) : (
          <CustomersClient
            initialRows={rows}
            initialHasMore={hasMore}
            totalCount={totalCount}
            initialFilters={filters}
            loadedAt={loadedAt}
          />
        )}
      </div>
    </AppShell>
  );
}
