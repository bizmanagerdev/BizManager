"use client";

import { useMemo, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import ProjectsListSkeleton, { ProjectsStripSkeleton } from "./ProjectsListSkeleton";
import { PageHeaderToolbarSpace } from "@/components/layout/PageHeaderToolbar";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import type { LocalCardViewer, LocalDashboardCards } from "@/lib/powersync/dashboard-local";
import { getResult, loadLocalDataCode, localClient } from "@/lib/powersync/local-results";
import { useLocalDatabase } from "@/lib/powersync/store";
import { loadMoreProjects } from "./actions";
import type { ProjectsFilters } from "./loadProjects";
import { withListCustomers } from "./loadProjectsPageData";
import ProjectsCustomerHeader from "./ProjectsCustomerHeader";
import { parseProjectsFilters } from "./projectsFilters";
import { fetchProjectsFirstPageFromServer } from "./projectsListCache";
import { ProjectsListSourceProvider, type ProjectsListSource } from "./ProjectsListSource";

const ProjectsClient = dynamic(() => import("./ProjectsClient"), { loading: () => <ProjectsListSkeleton /> });

// The /projects page drawn from the on-device copy (LOCAL_DATA_PAGES.projects):
// the list (first page, and the next ones as it scrolls), the tab counts and
// the new-project dialog's lists, worked out with the server's own loaders on
// the device — again by itself whenever a project, payment, expense… changes.
// Switching tabs, sorts and statuses (ProjectsClient changes the URL itself)
// is served from the device too. Searches still go to the server: they match
// customers and task text in ways the device doesn't yet. If the device's
// copy can't serve the page, it reloads as the server version (?data=server).

type Row = Record<string, unknown>;

export default function LocalProjectsPage({
  viewer,
  customerName,
}: {
  viewer: LocalCardViewer;
  customerName: string | null;
}) {
  const searchParams = useSearchParams();
  const serverHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("data", "server");
    return `/projects?${params.toString()}`;
  }, [searchParams]);

  // The list for the URL's tab and filters, without a search (see above).
  const filters: ProjectsFilters = { ...parseProjectsFilters((key) => searchParams.get(key)), q: "" };
  const list = useLocalCard({ kind: "projectsList", viewer, filters, page: "projects", serverHref });
  useDevicePageTiming("projects", list, list?.data.rows.length);
  const extras = useLocalCard({
    kind: "projectsExtras",
    viewer,
    filters: { customerId: filters.customerId },
    page: "projects",
    serverHref,
  });

  // The other lists ProjectsClient shows (another tab, the next page): from
  // the device too, except searches.
  const db = useLocalDatabase();
  const { userId, role, locale } = viewer;
  const source = useMemo<ProjectsListSource>(
    () => ({
      // Kept and kept current like the page's own list (lib/powersync/local-results.ts).
      firstPage: async (f) => {
        if (f.q || !db) return fetchProjectsFirstPageFromServer(f);
        const list = (await getResult(db, {
          kind: "projectsList",
          viewer: { userId, role, locale },
          filters: f,
        })) as LocalDashboardCards["projectsList"];
        return { rows: list.rows, hasMore: list.hasMore, totalCount: list.totalCount };
      },
      page: async (page, f) => {
        if (f.q || !db) return loadMoreProjects(page, f) as Promise<{ rows: Row[]; hasMore: boolean }>;
        const [[{ computeLocalListPage }], local] = await Promise.all([loadLocalDataCode(), localClient(db)]);
        return computeLocalListPage(local, "projectsList", f, page) as Promise<{ rows: Row[]; hasMore: boolean }>;
      },
    }),
    [db, userId, role, locale]
  );

  // The list's search / filter row (ProjectsClient's toolbar) is held open on
  // a phone from the first paint, before the list arrives.
  if (!list || !extras)
    return (
      <>
        <ProjectsStripSkeleton />
        <ProjectsListSkeleton />
      </>
    );

  const { rows, hasMore, totalCount } = list.data;
  const { tabCounts, options } = extras.data;
  const customerOptions = withListCustomers(options.customerOptions, rows);
  const customerId = list.data.filters.customerId;

  return (
    <>
      <PageHeaderToolbarSpace />
      {customerName ? (
        <ProjectsCustomerHeader
          customerName={customerName}
          phone={customerId ? customerOptions.find((o) => o.id === customerId)?.phone ?? null : null}
        />
      ) : null}
      <ProjectsListSourceProvider source={source}>
        <ProjectsClient
          initialProjects={rows as ComponentProps<typeof ProjectsClient>["initialProjects"]}
          initialHasMore={hasMore}
          totalCount={totalCount}
          customerOptions={customerOptions}
          managerOptions={options.managerOptions}
          currentUserId={userId}
          viewerRole={role}
          defaultProjectManagerId={options.defaultProjectManagerId ?? undefined}
          tabCounts={tabCounts}
          // The filters these rows are for — a moment behind the URL after a
          // switch, which ProjectsClient shows from the device meanwhile.
          initialFilters={list.data.filters}
        />
      </ProjectsListSourceProvider>
    </>
  );
}
