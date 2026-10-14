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
  const listRead = withLoadedAt(loadCustomersPage(supabase, { page: 1, filters }));
  // Awaited right after the check; this only keeps a failure that lands first
  // from being reported as unhandled meanwhile.
  listRead.catch(() => {});

  const { profile } = await profilePromise;
  const { rows, totalCount, hasMore, error: loadError, loadedAt } = await listRead;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
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
