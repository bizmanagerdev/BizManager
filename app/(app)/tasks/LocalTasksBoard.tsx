"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import { filterBoardLocally } from "@/lib/tasks/boardFilters";
import type { TasksFilters } from "./loadTasks";
import TasksBoardSkeleton from "./TasksBoardSkeleton";
import TasksPageClient from "./TasksPageClient";

// The tasks board drawn from the on-device copy (LOCAL_DATA_PAGES.tasks): the
// server's own loaders (loadTasksBoard, loadTaskPickerOptions) run on the
// device, again whenever a task, comment, reminder… changes — so a save shows
// up by itself once it's synced back, and the board is the same component the
// server version renders. If the device's copy can't serve it, the page
// reloads as the server version (?data=server).

export default function LocalTasksBoard({
  viewer,
  filters,
  canSeeAll,
}: {
  viewer: LocalCardViewer;
  /** The board's filters, from the URL. */
  filters: TasksFilters;
  canSeeAll: boolean;
}) {
  const searchParams = useSearchParams();
  const serverHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("data", "server");
    return `/tasks?${params.toString()}`;
  }, [searchParams]);

  const result = useLocalCard({ kind: "tasksBoard", viewer, filters, page: "tasks", serverHref });
  useDevicePageTiming("tasks", result, result?.data.items.length);

  // New filters: until the device's board for them is ready (a moment), the
  // board already here narrowed to them — what the server version shows while
  // its own answer is on the way.
  const filtersKey = JSON.stringify(filters);
  const tasks = useMemo(() => {
    if (!result) return null;
    if (result.filtersKey === filtersKey) return result.data.items;
    return filterBoardLocally(result.data.items, JSON.parse(filtersKey) as TasksFilters, result.data.filters, viewer.userId);
  }, [result, filtersKey, viewer.userId]);

  if (!result || !tasks) return <TasksBoardSkeleton />;

  const { options } = result.data;
  return (
    <TasksPageClient
      tasks={tasks}
      projects={options.projects}
      properties={options.properties}
      customers={options.customers}
      users={options.users}
      canSeeAll={canSeeAll}
      currentUserId={viewer.userId}
      locale={viewer.locale}
      initialFilters={filters}
    />
  );
}
