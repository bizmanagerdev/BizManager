// Board position for a task within its status column, stored as a plain
// double-precision number (lower = earlier). Two things need this to agree:
// the DEFAULT position a task gets when nobody has manually placed it yet
// (computeDefaultSortOrder, mirrored in the sort_order backfill migration),
// and the position a manual drag lands it on (computeInsertSortOrder, classic
// fractional indexing so a reorder never has to renumber the rest of the list).

// Pushes any "next year or later" due date past every ordinary value (today's
// epoch ms is ~1.7e12; even a due date centuries out stays under 1e13), so
// those tasks fall to the end regardless of how "soon" that date actually is.
const FAR_FUTURE_OFFSET = 1e13;
// Gap used when inserting at an edge (nothing on that side to average with).
const EDGE_GAP = 1000;

/**
 * Default position for a task that hasn't been manually dragged. Date-aware
 * sorting is a "todo"-column-only thing — every other column (in_progress,
 * done, blocked) is a plain "order added" list, newest on top, same as a task
 * with no due date:
 * - todo + a due date this year or earlier (incl. overdue) → sorts chronologically by date
 * - todo + a due date next year or later → pushed to the end, in date order among themselves
 * - anything else (todo with no date, or any non-todo column) → goes to the
 *   very TOP of the list — "added" means "now the newest", not "created_at
 *   happens to be a bigger number than whatever's already there".
 */
export function computeDefaultSortOrder(args: {
  status: string | null | undefined;
  dueDate: string | null | undefined;
  /** The current topmost (smallest) sort_order already in that column, if any. */
  currentMinInColumn: number | null | undefined;
  now?: Date;
}): number {
  const status = args.status || "todo";
  if (status === "todo" && args.dueDate) {
    const due = new Date(args.dueDate).getTime();
    if (Number.isFinite(due)) {
      const currentYear = (args.now ?? new Date()).getFullYear();
      const dueYear = new Date(args.dueDate).getFullYear();
      return dueYear > currentYear ? FAR_FUTURE_OFFSET + due : due;
    }
  }
  return computeInsertSortOrder(null, args.currentMinInColumn);
}

/**
 * Fractional-index position for dropping an item between two neighbors
 * (either may be absent — dropped at the start/end of the list).
 */
export function computeInsertSortOrder(
  beforeOrder: number | null | undefined,
  afterOrder: number | null | undefined
): number {
  const before = typeof beforeOrder === "number" && Number.isFinite(beforeOrder) ? beforeOrder : null;
  const after = typeof afterOrder === "number" && Number.isFinite(afterOrder) ? afterOrder : null;
  if (before !== null && after !== null) return (before + after) / 2;
  if (before !== null) return before + EDGE_GAP;
  if (after !== null) return after - EDGE_GAP;
  return Date.now();
}
