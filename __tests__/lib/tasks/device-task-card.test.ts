import { describe, expect, it } from "vitest";
import { readTaskCardFromDevice } from "@/lib/tasks/device-task-card";
import type { LocalReader } from "@/lib/powersync/local-supabase";

// A task's card read from the on-device copy, in the shape /api/tasks/get
// gives the task form — so the form opens filled in at once.

type Row = Record<string, unknown>;

/** A fake device database (rows as PowerSync stores them), answering the shim's simple reads. */
function fakeReader(tables: Record<string, Row[]>): LocalReader {
  return {
    async getAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const match = /^SELECT \* FROM ([a-z_]+)(?: WHERE (.*))?$/.exec(sql);
      if (!match) throw new Error(`fake reader can't run: ${sql}`);
      let rows = tables[match[1]] ?? [];
      if (match[2]) {
        let p = 0;
        for (const clause of match[2].split(" AND ")) {
          const eq = /^([a-z_]+) = \?$/.exec(clause);
          if (!eq) throw new Error(`fake reader can't filter: ${clause}`);
          const value = params[p++];
          rows = rows.filter((r) => r[eq[1]] === value);
        }
      }
      return rows.map((r) => ({ ...r })) as T[];
    },
  };
}

const task = {
  id: "t1", business_domain: "general_business", project_id: null, property_id: null, customer_id: "c1",
  assigned_user_id: "u2", subject: "להתקשר", description: "פרטים", subject_he: null, description_he: null,
  subject_ar: null, description_ar: null, due_date: "2026-10-09", due_time: null, city: null, address: null,
  priority: "high", status: "todo", created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
  notes: null, is_private: 1, private_owner_id: "u1",
};

describe("readTaskCardFromDevice", () => {
  it("the row, its members, comments with their authors' names, and open reminders", async () => {
    const reader = fakeReader({
      tasks: [task],
      task_members: [{ id: "t1:u3", task_id: "t1", user_id: "u3" }],
      task_comments: [
        { id: "k2", task_id: "t1", author_id: "u2", body: "שני", body_he: null, created_at: "2026-10-02T09:00:00Z", updated_at: null },
        { id: "k1", task_id: "t1", author_id: "u1", body: "ראשון", body_he: null, created_at: "2026-10-01T09:00:00Z", updated_at: null },
      ],
      reminders: [
        { id: "r1", task_id: "t1", remind_at: "2026-10-08T07:00:00Z", content: null, action_type: "other", status: "pending", assigned_to: "u2", created_at: "2026-10-01T08:00:00Z" },
      ],
      users: [
        { id: "u1", full_name: "אני", role: "admin", active: 1 },
        { id: "u2", full_name: "דנה", role: "worker", active: 1 },
        { id: "u3", full_name: "יוסי", role: "worker", active: 1 },
      ],
    });
    const card = await readTaskCardFromDevice(reader as never, "t1", "u1");
    expect(card).not.toBeNull();
    expect(card!.task).toMatchObject({ id: "t1", subject: "להתקשר", is_private: true, priority: "high" });
    expect(card!.memberIds).toEqual(["u3"]);
    expect(card!.comments.map((c) => [c.id, c.author_name])).toEqual([
      ["k1", "אני"],
      ["k2", "דנה"],
    ]);
    expect(card!.reminders).toEqual([
      expect.objectContaining({ id: "r1", status: "pending", assigned_to: "u2", assigned_to_name: "דנה" }),
    ]);
    expect(card!.viewerIsCreator).toBe(true);
    expect((await readTaskCardFromDevice(reader as never, "t1", "u2"))!.viewerIsCreator).toBe(false);
  });

  it("a task the copy doesn't hold: null (the form then asks the server)", async () => {
    const reader = fakeReader({ tasks: [], task_members: [], task_comments: [], reminders: [], users: [] });
    expect(await readTaskCardFromDevice(reader as never, "missing", "u1")).toBeNull();
  });
});
