"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { loadTasksPage, type TasksFilters } from "./loadTasks";

/** Fetch the next page of tasks for the infinite-scroll list. */
export async function loadMoreTasks(page: number, filters: TasksFilters) {
  const { supabase, profile } = await requireProfile();
  const canSeeAll = profile.role === "admin" || profile.role === "office";
  const { tasks, hasMore } = await loadTasksPage(supabase, {
    page,
    filters,
    userId: profile.id,
    canSeeAll,
  });
  return { rows: tasks, hasMore };
}
