import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";
import { loadProjectsPage, type ProjectsFilters } from "./loadProjects";
import { loadProjectsPickerOptions, loadProjectsTabCounts } from "./loadProjectsPageData";

/**
 * The projects list, its counts and the dialog's lists as the server reads
 * them, for the device to compare with its own (once a day per device —
 * lib/powersync/device-check.ts). Rendered in a Suspense boundary after the
 * page, so it never holds the page up.
 */
export default async function ProjectsServerCheck({
  supabase,
  filters,
  userId,
  role,
  locale,
}: {
  supabase: SupabaseClient;
  filters: ProjectsFilters;
  userId: string;
  role: string;
  locale: Locale;
}) {
  const [list, options, tabCounts] = await Promise.all([
    loadProjectsPage(supabase, { page: 1, filters }),
    loadProjectsPickerOptions(supabase),
    loadProjectsTabCounts(supabase, filters.customerId),
  ]);
  if (list.error) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("projects")}
      snapshot={{
        renderedAt: new Date(list.loadedAt).toISOString(),
        userId,
        role,
        locale,
        todayIso: israelDateKey(),
        cards: {
          projectsList: { filters, rows: list.rows, hasMore: list.hasMore, totalCount: list.totalCount },
          projectsExtras: { filters: { customerId: filters.customerId }, tabCounts, options },
        },
      }}
    />
  );
}
