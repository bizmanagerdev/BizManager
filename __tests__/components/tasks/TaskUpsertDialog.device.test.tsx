// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Opening a task where the device holds a copy (PowerSync): the form is
// filled in and editable at once from the copy, and what only the server has
// — the tags, the finished reminders, the history — follows without counting
// as an edit (nothing is saved just by opening).

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

const device = vi.hoisted(() => ({
  db: {} as unknown,
  /** Where saves go: the device copy (a fake database recording its writes), or null — the server. */
  saves: null as null | { db: { execute: ReturnType<typeof vi.fn>; getOptional: ReturnType<typeof vi.fn> }; viewerId: string },
}));
vi.mock("@/lib/powersync/store", () => ({ readyLocalDatabase: () => device.db, readyDeviceSaves: () => device.saves }));

const card = vi.hoisted(() => ({
  task: {
    id: "t1", business_domain: "general_business", project_id: null, property_id: null, customer_id: null,
    assigned_user_id: "u1", subject: "להתקשר לספק", description: null, subject_he: null, description_he: null,
    subject_ar: null, description_ar: null, due_date: null, due_time: null, city: null, address: null,
    priority: "medium", status: "todo", created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
    notes: null, is_private: false, private_owner_id: "u1",
  },
  memberIds: [] as string[],
  comments: [] as unknown[],
  reminders: [] as unknown[],
  viewerIsCreator: true,
}));
vi.mock("@/lib/tasks/device-task-card", () => ({ readTaskCardFromDevice: vi.fn(async () => card) }));

const tags = vi.hoisted(() => ({ resolve: (_ids: string[]) => {}, promise: null as Promise<string[]> | null }));
vi.mock("@/components/tags/TagPicker", () => ({
  fetchExistingTagIds: () => tags.promise,
  invalidateTagCache: () => {},
  TagPicker: () => null,
}));

const saves = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (_url: string, _body?: unknown, _label?: string, _options?: unknown) => ({ ok: true, queued: false, data: {} })),
}));
vi.mock("@/lib/offline-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-queue")>()),
  offlineFetch: saves.offlineFetch,
}));

import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";

const serverCard = {
  task: card.task,
  members: [],
  comments: [{ id: "k1", author_id: "u1", author_name: "אני", body: "כבר דיברתי", body_he: null, created_at: "2026-10-02T08:00:00Z" }],
  reminders: [{ id: "r9", remind_at: "2026-09-01T08:00:00Z", content: "ישן", action_type: "other", status: "done", assigned_to: "u1", assigned_to_name: "אני" }],
  history: [],
  viewer_is_creator: true,
};

describe("the task form, opened from the device copy", () => {
  beforeEach(() => {
    saves.offlineFetch.mockClear();
    device.saves = null;
    tags.promise = new Promise((resolve) => (tags.resolve = resolve));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/tasks/get") return new Response(JSON.stringify(serverCard), { status: 200 });
        if (url === "/api/tasks/attachments/list") return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
        return new Response("{}", { status: 404 });
      })
    );
  });

  it("is filled in at once, and the server's tags and reminders arriving later are not an edit", async () => {
    // A form waiting on the server would still be empty here.
    render(
      <TaskUpsertDialog
        open
        onOpenChange={() => {}}
        mode="edit"
        taskId="t1"
        users={[{ id: "u1", label: "אני" }]}
        projects={[]}
        properties={[]}
        customers={[]}
        currentUserId="u1"
        locale="he"
      />
    );
    await act(async () => {});
    expect(screen.getByDisplayValue("להתקשר לספק")).toBeTruthy();

    // The server's part lands: tags the task already has, a finished reminder, a comment.
    await act(async () => {
      tags.resolve(["tag-a"]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Longer than the autosave delay: nothing was edited, so nothing is saved.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(saves.offlineFetch).not.toHaveBeenCalled();
    // The server was still asked for what only it has.
    expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toContain("/api/tasks/get");
  });

  it("an edit made straight away is saved — just the edit, the tags untouched (no device saves: the server)", async () => {
    render(
      <TaskUpsertDialog
        open
        onOpenChange={() => {}}
        mode="edit"
        taskId="t1"
        users={[{ id: "u1", label: "אני" }]}
        projects={[]}
        properties={[]}
        customers={[]}
        currentUserId="u1"
        locale="he"
      />
    );
    await act(async () => {});
    fireEvent.change(screen.getByDisplayValue("להתקשר לספק"), { target: { value: "להתקשר לספק מחר" } });
    await act(async () => {
      tags.resolve(["tag-a"]);
    });
    await waitFor(() => expect(saves.offlineFetch).toHaveBeenCalled(), { timeout: 5000 });
    expect(saves.offlineFetch).toHaveBeenCalledTimes(1);
    expect(saves.offlineFetch.mock.calls[0][0]).toBe("/api/tasks/update");
    expect(saves.offlineFetch.mock.calls[0][1]).toEqual({ id: "t1", subject: "להתקשר לספק מחר" });
  });

  it("with device saves: the edit is written on the device copy — nothing sent from the form itself", async () => {
    const execute = vi.fn(async () => ({}));
    device.saves = { db: { execute, getOptional: vi.fn(async () => null) }, viewerId: "u1" };
    render(
      <TaskUpsertDialog
        open
        onOpenChange={() => {}}
        mode="edit"
        taskId="t1"
        users={[{ id: "u1", label: "אני" }]}
        projects={[]}
        properties={[]}
        customers={[]}
        currentUserId="u1"
        locale="he"
      />
    );
    await act(async () => {});
    fireEvent.change(screen.getByDisplayValue("להתקשר לספק"), { target: { value: "להתקשר לספק מחר" } });
    await act(async () => {
      tags.resolve(["tag-a"]);
    });
    await waitFor(() => expect(execute).toHaveBeenCalled(), { timeout: 5000 });
    expect(execute).toHaveBeenCalledWith("UPDATE tasks SET subject = ? WHERE id = ?", ["להתקשר לספק מחר", "t1"]);
    expect(saves.offlineFetch).not.toHaveBeenCalled();
  });
});
