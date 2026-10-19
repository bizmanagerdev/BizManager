"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { findInsideMatches, type InsideMatches } from "@/lib/global-search";
import {
  loadProjectsByIds,
  loadProjectsPage,
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

// The project search index is a GET now: app/api/search-index/[kind]/route.ts.

/**
 * Projects reached through anything inside them — tasks and task replies,
 * notes, addresses, payments, expenses, shifts, dates, hours, amounts — the
 * "deep content" matches the instant name/customer index can't see, with why
 * each one came up (owner, 2026-10-19). Run in the background after the
 * instant paint so the type-ahead isn't held up.
 */
export async function findProjectContentMatches(query: string): Promise<InsideMatches> {
  const { supabase, profile } = await requireProfile();
  return findInsideMatches(supabase, { query, kind: "project", viewerRole: profile.role, viewerId: profile.id });
}
