// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

// Task saves on the device copy first: what each one writes there (the queue
// then sends it — see __tests__/lib/powersync/device-saves.test.ts), the
// server's own defaults for a new task, and the server path when this device
// doesn't save on its copy.

const device = vi.hoisted(() => ({ saves: null as unknown }));
vi.mock("@/lib/powersync/store", () => ({ readyDeviceSaves: () => device.saves }));
const queue = vi.hoisted(() => ({ offlineFetch: vi.fn(async () => ({ queued: false, ok: true, data: {} })) }));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: queue.offlineFetch }));

import { deviceTaskSaves, saveTaskStatus } from "@/lib/tasks/device-task-saves";

function fakeDb(topSortOrder: number | null = 10) {
  return {
    execute: vi.fn(async (_sql: string, _params?: unknown[]) => ({})),
    getOptional: vi.fn(async () => ({ sort_order: topSortOrder })),
  };
}

describe("task saves on the device copy", () => {
  beforeEach(() => {
    device.saves = null;
    queue.offlineFetch.mockClear();
  });

  it("none where this device doesn't save on its copy", () => {
    expect(deviceTaskSaves()).toBeNull();
  });

  it("a new task: the server's defaults, the top of its column, its members, tags and reminders alongside", async () => {
    const db = fakeDb(10);
    device.saves = { db, viewerId: "me" };
    const created = await deviceTaskSaves()!.create({
      subject: "  להתקשר  ",
      member_ids: ["u3"],
      tag_ids: ["t1"],
      reminders: [{ remind_at: "2026-10-08T07:00:00.000Z", content: null }],
    });
    expect(created).toMatchObject({
      subject: "להתקשר", assigned_user_id: "me", status: "todo", priority: "medium",
      business_domain: "general_business", is_private: false,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/^INSERT INTO tasks \(id, subject, .*private_owner_id, sort_order, created_at, _extras\) VALUES/);
    expect(params[0]).toBe(created.id);
    expect(params).toContain("me"); // owner
    const sortOrder = params[params.length - 3] as number;
    expect(sortOrder).toBeLessThan(10); // above the column's top card
    expect(JSON.parse(params[params.length - 1] as string)).toMatchObject({
      member_ids: ["u3"], tag_ids: ["t1"], reminders: [{ remind_at: "2026-10-08T07:00:00.000Z", content: null }],
    });
  });

  it("an edit: just the changed fields — and members or tags, when they changed, ride along", async () => {
    const db = fakeDb();
    device.saves = { db, viewerId: "me" };
    await deviceTaskSaves()!.update("t1", { subject: "חדש", is_private: true });
    expect(db.execute).toHaveBeenLastCalledWith("UPDATE tasks SET subject = ?, is_private = ? WHERE id = ?", ["חדש", 1, "t1"]);
    await deviceTaskSaves()!.update("t1", { member_ids: ["u4"] });
    const [sql, params] = db.execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toBe("UPDATE tasks SET _extras = ? WHERE id = ?");
    expect(JSON.parse(params[0] as string)).toMatchObject({ member_ids: ["u4"] });
  });

  it("a comment, by the person whose copy it is", async () => {
    const db = fakeDb();
    device.saves = { db, viewerId: "me" };
    const comment = await deviceTaskSaves()!.addComment("t1", "בוצע");
    expect(comment).toMatchObject({ author_id: "me", body: "בוצע" });
    expect(db.execute).toHaveBeenCalledWith(
      "INSERT INTO task_comments (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      [comment.id, "t1", "me", "בוצע", expect.any(String)]
    );
  });

  it("marking done: the copy when there is one — otherwise the status route, as before", async () => {
    const db = fakeDb();
    device.saves = { db, viewerId: "me" };
    expect(await saveTaskStatus("t1", "done", "label")).toMatchObject({ ok: true, onDevice: true });
    expect(db.execute).toHaveBeenCalledWith("UPDATE tasks SET status = ? WHERE id = ?", ["done", "t1"]);
    expect(queue.offlineFetch).not.toHaveBeenCalled();

    device.saves = null;
    expect(await saveTaskStatus("t1", "done", "label")).toMatchObject({ ok: true, onDevice: false });
    expect(queue.offlineFetch).toHaveBeenCalledWith("/api/tasks/update-status", { id: "t1", status: "done" }, "label");
  });
});
