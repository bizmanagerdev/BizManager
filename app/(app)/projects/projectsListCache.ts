import type { ProjectsFilters } from "@/app/(app)/projects/loadProjects";
import { projectsFiltersKey, projectsFiltersQuery } from "@/app/(app)/projects/projectsFilters";

// The first page of each projects list (tab + filters) this browser session
// has loaded, so switching back to a list shows it at once instead of waiting
// on the server. Module scope: it outlives the page component, so it's still
// there after visiting a project and coming back. ProjectsClient decides when
// a kept page is old enough to refresh, and drops the others after a save.

type Row = Record<string, unknown>;

export type ProjectsFirstPage = {
  rows: Row[];
  hasMore: boolean;
  totalCount: number | null;
  /** When it was loaded (Date.now()); 0 = keep showing it, but refresh it. */
  at: number;
};

/** Within this, a kept page is current enough to show without asking again. */
export const PROJECTS_FIRST_PAGE_FRESH_MS = 15_000;

const firstPages = new Map<string, ProjectsFirstPage>();
const inflight = new Map<string, Promise<ProjectsFirstPage | null>>();
// Bumped when kept pages are dropped, so a load already on its way from
// before then (it may predate a save) isn't stored over the fresh state.
let generation = 0;

export function getProjectsFirstPage(key: string): ProjectsFirstPage | null {
  return firstPages.get(key) ?? null;
}

export function rememberProjectsFirstPage(key: string, page: ProjectsFirstPage) {
  firstPages.set(key, page);
}

/** After a save: what other lists hold may have changed (a quote approved, a
 *  project closed), so they're loaded again rather than shown from memory. */
export function forgetOtherProjectsFirstPages(keepKey: string) {
  generation += 1;
  for (const key of Array.from(firstPages.keys())) if (key !== keepKey) firstPages.delete(key);
  inflight.clear();
}

/** Coming back to the page: keep the other lists for an instant switch, but
 *  have them refreshed when they're next shown. */
export function markOtherProjectsFirstPagesStale(keepKey: string) {
  for (const [key, page] of firstPages) if (key !== keepKey) firstPages.set(key, { ...page, at: 0 });
}

/** Load (and keep) the first page for these filters. One request per list at
 *  a time; resolves to null on any failure — callers keep what they show. */
export function fetchProjectsFirstPage(filters: ProjectsFilters): Promise<ProjectsFirstPage | null> {
  const key = projectsFiltersKey(filters);
  const pending = inflight.get(key);
  if (pending) return pending;
  const startedIn = generation;
  const promise = fetch(`/api/projects/list?${projectsFiltersQuery(filters)}`, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { rows?: unknown; hasMore?: unknown; totalCount?: unknown };
      const page: ProjectsFirstPage = {
        rows: Array.isArray(body.rows) ? (body.rows as Row[]) : [],
        hasMore: body.hasMore === true,
        totalCount: typeof body.totalCount === "number" ? body.totalCount : null,
        at: Date.now(),
      };
      // Asked for before a save landed — what it holds may predate it.
      if (startedIn !== generation) return null;
      firstPages.set(key, page);
      return page;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
