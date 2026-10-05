import type { TaskBoardItem } from "@/app/(app)/tasks/loadTasks";

// The task board's filters, as the URL carries them.
export type TaskBoardFilters = {
  q: string;
  priority: string;
  domain: string;
  linkedId: string;
  /** "mine" = assigned to me, a member of, or private and mine; "all" = everyone's. */
  scope: "mine" | "all";
};

/**
 * The board's tasks for `next` filters, worked out from the tasks already on
 * screen (loaded for `current`) — what the board shows the moment a filter is
 * picked, until the server's own board for `next` arrives a moment later.
 *
 * Only what changed is applied: the loaded tasks already match `current`, and
 * re-applying a filter by a slightly different rule than the server's would
 * only hide tasks that belong. A filter that WIDENS the board (one taken away,
 * "mine" → "all") can't add tasks that were never loaded; the server's answer
 * brings those.
 */
export function filterBoardLocally(
  tasks: TaskBoardItem[],
  next: TaskBoardFilters,
  current: TaskBoardFilters,
  userId: string
): TaskBoardItem[] {
  const query = next.q.trim().toLowerCase();
  const byQuery = next.q !== current.q && query !== "";
  const byPriority = next.priority !== current.priority && next.priority !== "";
  const byDomain = next.domain !== current.domain && next.domain !== "";
  const linkColumn =
    next.domain === "logistics_projects" ? "project_id" : next.domain === "property_management" ? "property_id" : null;
  const byLink = next.linkedId !== current.linkedId && next.linkedId !== "" && linkColumn !== null;
  const byMine = next.scope === "mine" && current.scope === "all";
  if (!byQuery && !byPriority && !byDomain && !byLink && !byMine) return tasks;

  return tasks.filter((task) => {
    if (byPriority && task.priority !== next.priority) return false;
    if (byDomain && task.business_domain !== next.domain) return false;
    if (byLink && linkColumn && task[linkColumn] !== next.linkedId) return false;
    if (byQuery) {
      const subjects = [task.subject, task.subject_he, task.subject_ar];
      if (!subjects.some((subject) => subject?.toLowerCase().includes(query))) return false;
    }
    if (byMine) {
      // A private task on the board is always the viewer's own (RLS).
      const mine =
        task.is_private || task.assigned_user_id === userId || task.members.some((member) => member.id === userId);
      if (!mine) return false;
    }
    return true;
  });
}
