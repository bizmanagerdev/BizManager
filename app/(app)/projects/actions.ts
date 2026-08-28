"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { findProjectIdsMatchingContent } from "@/lib/search/findMatchingChildIds";
import {
  loadProjectsByIds,
  loadProjectsPage,
  loadProjectSearchIndexRows,
  type ProjectsFilters,
} from "./loadProjects";

/** Fetch the next page of projects for the infinite-scroll list. */
export async function loadMoreProjects(page: number, filters: ProjectsFilters) {
  const { supabase } = await requireProfile();
  const { rows, hasMore } = await loadProjectsPage(supabase, { page, filters });
  return { rows, hasMore };
}

/** Fetch enriched project rows (financials, payment status) for an explicit id list. */
export async function loadProjectRowsByIds(ids: string[]) {
  const { supabase } = await requireProfile();
  const rows = await loadProjectsByIds(supabase, ids);
  return { rows };
}

/**
 * Load the full lightweight project index for the client-side in-memory search
 * (instant project type-ahead on the projects list). Re-authenticates per call.
 */
export async function loadProjectSearchIndex() {
  const { supabase } = await requireProfile();
  const projects = await loadProjectSearchIndexRows(supabase);
  return { projects };
}

/**
 * Project ids reached only through a task/task-comment or the project's own
 * notes/items-to-move — the "deep content" matches the instant name/customer
 * index can't see. Run in the background after the instant paint so those
 * projects still surface without delaying the type-ahead.
 */
export async function findProjectContentMatches(query: string) {
  const { supabase } = await requireProfile();
  const { ids } = await findProjectIdsMatchingContent(supabase, query, 300);
  return { ids };
}
