import type { AuditFeedItem } from "@/lib/audit";
import { isCreate, isDelete, isUpdate } from "@/lib/activity/sentence";

// Saving an order deletes every line and writes them all again (and the stock
// reservation behind each), so one small edit — or just marking it delivered —
// logs dozens of "נמחק / נוצר" rows. Compared line by line, they come down to
// what actually changed: "פח 2 → 3", "נוסף: מלט ×5", "הוסר: חול ×2" — or to
// nothing at all.

export type OrderLineChange =
  | { kind: "changed"; key: string; name: string; from: number; to: number }
  | { kind: "added"; key: string; name: string; qty: number }
  | { kind: "removed"; key: string; name: string; qty: number };

export type OrderLineDiff = {
  /** The rows were order lines (so they fold into this summary, not a list). */
  hadLines: boolean;
  changes: OrderLineChange[];
};

/** The net change to an order's lines across one save (the rows of one group). */
export function orderLineDiff(rows: AuditFeedItem[]): OrderLineDiff {
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const names = new Map<string, string>();
  const order: string[] = [];
  let hadLines = false;

  const add = (map: Map<string, number>, key: string, qty: number) => map.set(key, (map.get(key) ?? 0) + qty);

  for (const row of rows) {
    const line = row.facts?.line;
    if (row.tableName !== "order_items" || !line) continue;
    hadLines = true;
    if (!names.has(line.key)) {
      names.set(line.key, line.name ?? "פריט");
      order.push(line.key);
    }
    if (isCreate(row.action)) add(after, line.key, line.qty);
    else if (isDelete(row.action)) add(before, line.key, line.qty);
    else if (isUpdate(row.action)) {
      add(before, line.key, line.qtyBefore ?? line.qty);
      add(after, line.key, line.qty);
    }
  }

  const changes: OrderLineChange[] = [];
  for (const key of order) {
    const name = names.get(key) ?? "פריט";
    const from = before.get(key);
    const to = after.get(key);
    if (from !== undefined && to !== undefined) {
      if (from !== to) changes.push({ kind: "changed", key, name, from, to });
    } else if (to !== undefined) {
      changes.push({ kind: "added", key, name, qty: to });
    } else if (from !== undefined) {
      changes.push({ kind: "removed", key, name, qty: from });
    }
  }
  return { hadLines, changes };
}

/**
 * Whether a group's rows are the plumbing of an order save that the summary
 * above already accounts for: its lines and their stock reservations.
 */
export function isOrderPlumbing(row: AuditFeedItem): boolean {
  return row.tableName === "order_items" || (row.tableName === "inventory_movements" && row.parentKey?.startsWith("order:") === true);
}
