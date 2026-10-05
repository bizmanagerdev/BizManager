import type { ProjectsFilters, ProjectsSort, ProjectsView } from "@/app/(app)/projects/loadProjects";

// How the projects list reads its filters out of the URL — one definition for
// the server page, the list GET route and the client, so a tab the browser
// keeps (ProjectsClient) is always keyed exactly the way the server would have
// rendered it. Pure: safe to import from client code.

const SORTS: readonly ProjectsSort[] = ["recent", "start_date", "start_date_desc", "profit_desc"];

export const DEFAULT_PROJECTS_SORT: ProjectsSort = "start_date_desc";

export function parseProjectsView(value: string | null | undefined): ProjectsView {
  return value === "quotes" || value === "closed" ? value : "projects";
}

export function parseProjectsFilters(get: (key: string) => string | null | undefined): ProjectsFilters {
  const trimmed = (key: string) => {
    const value = get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const sort = trimmed("sort");
  return {
    view: parseProjectsView(get("view")),
    status: trimmed("status") || "all",
    customerId: trimmed("customer_id") || null,
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as ProjectsSort) : DEFAULT_PROJECTS_SORT,
    q: trimmed("q"),
  };
}

/** One string per distinct list — what the client caches a first page under. */
export function projectsFiltersKey(filters: ProjectsFilters): string {
  return [filters.view, filters.status, filters.sort, filters.q, filters.customerId ?? ""].join("|");
}

/** The query string the list GET route reads back with parseProjectsFilters. */
export function projectsFiltersQuery(filters: ProjectsFilters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.view !== "projects") params.set("view", filters.view);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.sort !== DEFAULT_PROJECTS_SORT) params.set("sort", filters.sort);
  if (filters.q) params.set("q", filters.q);
  if (filters.customerId) params.set("customer_id", filters.customerId);
  if (page !== 1) params.set("page", String(page));
  return params.toString();
}
