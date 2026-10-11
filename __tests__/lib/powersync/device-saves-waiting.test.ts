import { describe, expect, it } from "vitest";
import { countDeviceSavesWaiting, readDeviceSavesWaiting } from "@/lib/powersync/device-saves-waiting";

// The red bar's list shows the saves waiting on the phone's own copy (PowerSync's
// ps_crud queue) too — one line per row changed, with the row's name.

type Op = { op: string; type: string; id: string };

function fakeDb(ops: Op[], names: Record<string, string>) {
  const crud = ops.map((op, i) => ({ id: i + 1, data: JSON.stringify({ ...op, data: {} }) }));
  return {
    getAll: async (sql: string) => {
      expect(sql).toContain("FROM ps_crud");
      return crud.map(({ data }) => ({ data }));
    },
    getOptional: async (sql: string, params?: unknown[]) => {
      if (sql.includes("count(DISTINCT")) {
        return { n: new Set(ops.map((op) => `${op.type}:${op.id}`)).size };
      }
      const id = String(params?.[0]);
      return id in names ? { name: names[id] } : null;
    },
  } as never;
}

describe("readDeviceSavesWaiting", () => {
  it("one line per row, named, saying what happened to it", async () => {
    const db = fakeDb(
      [
        { op: "PUT", type: "tasks", id: "t1" },
        { op: "PATCH", type: "tasks", id: "t1" },
        { op: "PATCH", type: "projects", id: "p1" },
        { op: "PUT", type: "task_comments", id: "c1" },
        { op: "DELETE", type: "order_items", id: "i1" },
        { op: "PATCH", type: "something_new", id: "x1" },
      ],
      { t1: "להזמין חומר", p1: "דירת כהן", c1: "להזמין חומר" }
    );
    expect(await readDeviceSavesWaiting(db)).toEqual([
      { key: "tasks:t1", label: "משימה: להזמין חומר", change: "new" },
      { key: "projects:p1", label: "פרויקט: דירת כהן", change: "changed" },
      { key: "task_comments:c1", label: "תגובה למשימה: להזמין חומר", change: "new" },
      { key: "order_items:i1", label: "שורה בהזמנה", change: "removed" },
      { key: "something_new:x1", label: "שינוי", change: "changed" },
    ]);
    expect(await countDeviceSavesWaiting(db)).toBe(5);
  });

  it("nothing waiting: no lines", async () => {
    const db = fakeDb([], {});
    expect(await readDeviceSavesWaiting(db)).toEqual([]);
    expect(await countDeviceSavesWaiting(db)).toBe(0);
  });
});
