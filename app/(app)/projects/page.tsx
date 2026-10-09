import { Suspense } from "react";
import dynamic from "next/dynamic";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import AppShell from "@/components/layout/AppShell";
import ProjectsListSkeleton from "@/app/(app)/projects/ProjectsListSkeleton";
import { loadProjectsPage } from "@/app/(app)/projects/loadProjects";
import {
  loadProjectsPickerOptions,
  loadProjectsTabCounts,
  withListCustomers,
} from "@/app/(app)/projects/loadProjectsPageData";
import { parseProjectsFilters } from "@/app/(app)/projects/projectsFilters";
import LocalProjectsPage from "@/app/(app)/projects/LocalProjectsPage";
import ProjectsCustomerHeader from "@/app/(app)/projects/ProjectsCustomerHeader";
import ProjectsServerCheck from "@/app/(app)/projects/ProjectsServerCheck";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW, localDataEnabledFor } from "@/lib/powersync/config";
import { israelDateKey } from "@/lib/timezone";

const ProjectsClient = dynamic(() => import("@/app/(app)/projects/ProjectsClient"), {
  loading: () => <ProjectsListSkeleton />,
});

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    customer_id?: string;
    customer_name?: string;
    view?: string;
    status?: string;
    sort?: string;
    q?: string;
    data?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  // The same reading of the URL the list GET route and the client use, so a
  // tab the browser keeps matches what this page would have rendered.
  const filters = parseProjectsFilters((key) => {
    const value = params[key as keyof typeof params];
    return typeof value === "string" ? value : null;
  });
  const { customerId } = filters;
  const customerName =
    typeof params.customer_name === "string" && params.customer_name.trim()
      ? params.customer_name.trim()
      : null;

  // The page's queries and the "who's asking" check go out together. They run
  // under the caller's own RLS whatever their role, and a caller who isn't
  // staff is still redirected below before anything is rendered — the check
  // just no longer puts its users lookup in front of every query. With the
  // device version on for everyone (LOCAL_DATA_PAGES.projects) they wait for
  // the check instead, and go out only for people without a device copy.
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireStaffPage();
  const startReads = () => {
    const reads = Promise.all([
      loadProjectsPage(supabase, { page: 1, filters }),
      loadProjectsPickerOptions(supabase),
      // Tab counts — in this batch so they run concurrently instead of as a
      // second sequential round-trip wave.
      loadProjectsTabCounts(supabase, customerId),
    ]);
    // Awaited right after the check; this only keeps a failure that lands
    // first from being reported as unhandled meanwhile.
    reads.catch(() => {});
    return reads;
  };
  const earlyReads = LOCAL_DATA_PAGES.projects ? null : startReads();

  const { profile } = await profilePromise;

  // The device version: the list, its counts and the dialog's lists are worked
  // out from this person's on-device copy (LocalProjectsPage). Searches still
  // go to the server. ?data=server is the way back when the copy can't serve it;
  // a device whose copy is still incomplete gets the server version at once.
  if (params.data !== "server" && !filters.q && (await devicePageOn("projects", profile))) {
    // Once a day per device, the server's own list too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.projects && (await deviceCheckDue("projects"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <div className="space-y-4">
          <DeviceFrameMark page="projects" renderedAt={serverRenderedAt()} />
          <LocalProjectsPage
            viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }}
            customerName={customerName}
          />
          {checkDue ? (
            <Suspense fallback={null}>
              <ProjectsServerCheck
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

  const [projectsResult, options, tabCounts] = await (earlyReads ?? startReads());

  const rowsWithPaymentStatus = projectsResult.rows;
  const loadError = projectsResult.error;
  const customerOptionsFinal = withListCustomers(options.customerOptions, rowsWithPaymentStatus);
  const totalCount = projectsResult.totalCount;
  const hasMore = projectsResult.hasMore;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        {/* The alert bar lives inside ProjectsClient, below the tabs — it has to
            sit under them, and the tabs are that component's own JSX. */}
        {customerName ? (
          <ProjectsCustomerHeader
            customerName={customerName}
            phone={customerId ? customerOptionsFinal.find((o) => o.id === customerId)?.phone ?? null : null}
          />
        ) : null}

        {/* The device-copy shadow check for this list, its counts and the
            dialog's lists (lib/powersync/dashboard-shadow.ts) — not for
            searches, which still go to the server. */}
        {LOCAL_DATA_SHADOW.projects && localDataEnabledFor(profile.role) && !filters.q && !loadError ? (
          <DashboardLocalShadow
            snapshot={{
              renderedAt: new Date(projectsResult.loadedAt).toISOString(),
              userId: profile.id,
              role: profile.role ?? "",
              locale: profile.locale,
              todayIso: israelDateKey(),
              cards: {
                projectsList: { filters, rows: rowsWithPaymentStatus, hasMore, totalCount },
                projectsExtras: { filters: { customerId }, tabCounts, options },
              },
            }}
          />
        ) : null}

        {loadError ? (
          <div className="text-destructive text-sm">שגיאה בטעינת פרויקטים: {loadError}</div>
        ) : (
          <ProjectsClient
            initialProjects={rowsWithPaymentStatus}
            initialHasMore={hasMore}
            totalCount={totalCount}
            customerOptions={customerOptionsFinal}
            managerOptions={options.managerOptions}
            currentUserId={profile.id}
            viewerRole={profile.role}
            defaultProjectManagerId={options.defaultProjectManagerId ?? undefined}
            tabCounts={tabCounts}
            initialFilters={filters}
            // When the rows were read — the nav prefetches this page ahead of a
            // click and the browser may show that copy minutes later, so the
            // list refreshes itself when it's older than a few seconds.
            renderedAt={projectsResult.loadedAt}
          />
        )}
      </div>
    </AppShell>
  );
}
