"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { loadProjectsPage, type ProjectsFilters } from "./loadProjects";

/** Fetch the next page of projects for the infinite-scroll list. */
export async function loadMoreProjects(page: number, filters: ProjectsFilters) {
  const { supabase } = await requireProfile();
  const { rows, hasMore } = await loadProjectsPage(supabase, { page, filters });
  return { rows, hasMore };
}
