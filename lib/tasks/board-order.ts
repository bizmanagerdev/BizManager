import { BOARD_STATUSES } from "@/app/(app)/tasks/loadTasks";

// The board's order, wherever tasks are listed (owner, 2026-10-09: the
// dashboard's "המשימות שלי" ignored how they're dragged on the board): the
// lists in the order the person arranged them on the board (kept per device,
// in localStorage — TasksPageClient), each list top to bottom by sort_order.

/** Where a person's list order is kept on this device (TasksPageClient writes it). */
export function boardColumnOrderKey(userId: string): string {
  return `tasks-board-order:${userId}`;
}

/** This device's list order for the person — the board's default when none is kept (or it can't be read). */
export function readBoardColumnOrder(userId: string | null | undefined): string[] {
  const fallback: string[] = [...BOARD_STATUSES];
  if (!userId || typeof localStorage === "undefined") return fallback;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(boardColumnOrderKey(userId)) ?? "null");
    if (!Array.isArray(parsed)) return fallback;
    const valid = parsed.filter((s): s is string => typeof s === "string" && fallback.includes(s));
    return valid.length > 0 ? [...valid, ...fallback.filter((s) => !valid.includes(s))] : fallback;
  } catch {
    return fallback;
  }
}

type Ordered = { id: string; status: string | null; sort_order: number | null };

/** Tasks as the board shows them: by list (in `columnOrder`), then sort_order (unset last), then id. */
export function sortLikeBoard<T extends Ordered>(tasks: T[], columnOrder: readonly string[]): T[] {
  const listIndex = (status: string | null) => {
    const index = columnOrder.indexOf(status || "todo");
    return index < 0 ? columnOrder.length : index;
  };
  return [...tasks].sort(
    (a, b) =>
      listIndex(a.status) - listIndex(b.status) ||
      (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
