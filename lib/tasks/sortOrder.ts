// Board position for a task within its status column, stored as a plain
// double-precision number (lower = earlier). There is no date-based ordering
// (user, 2026-10-04: "remove the date ordering from tasks — every new task gets
// added to the top and the users can move the tasks in the list to wherever
// they want"): a new task goes to the TOP of its column, and a manual drag lands
// it wherever it was dropped — classic fractional indexing, so a reorder never
// has to renumber the rest of the list.

// Gap used when inserting at an edge (nothing on that side to average with).
const EDGE_GAP = 1000;

/**
 * Fractional-index position for dropping an item between two neighbors
 * (either may be absent — dropped at the start/end of the list). A new task's
 * position is `computeInsertSortOrder(null, <current top of its column>)`.
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
