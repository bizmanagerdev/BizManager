"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { InfinitePage } from "@/hooks/useInfiniteScroll";
import type { ProjectsFilters } from "./loadProjects";
import type { ProjectsFirstPageLoader } from "./projectsListCache";

// Where ProjectsClient's lists come from besides the page's own first render:
// the server (/api/projects/list, the loadMoreProjects action) — or, on the
// page's device version (LocalProjectsPage), the on-device copy.

type Row = Record<string, unknown>;

export type ProjectsListSource = {
  /** The first page of a list (tab + filters) — switching tabs, a sort, a status. */
  firstPage: ProjectsFirstPageLoader;
  /** Page 2, 3… as the list scrolls. */
  page: (page: number, filters: ProjectsFilters) => Promise<InfinitePage<Row>>;
};

const ProjectsListSourceContext = createContext<ProjectsListSource | null>(null);

export function ProjectsListSourceProvider({ source, children }: { source: ProjectsListSource; children: ReactNode }) {
  return <ProjectsListSourceContext.Provider value={source}>{children}</ProjectsListSourceContext.Provider>;
}

/** The device's list source, or null on the server version. */
export function useProjectsListSource(): ProjectsListSource | null {
  return useContext(ProjectsListSourceContext);
}
