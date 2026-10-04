import { describe, it, expect, vi, beforeEach } from "vitest";

// Contract tests for POST /api/tasks/update — the open task card saves itself
// field by field (autosave), so the route must cope with a body that carries
// only what changed: no extra reads for fields it doesn't need, members diffed
// rather than rewritten, and no "you've been assigned" alert unless the save
// actually set the assignee.

const { requireRouteAccess, notifyTaskAssignees, syncEntityTags, translateToHebrew } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  notifyTaskAssignees: vi.fn(async () => {}),
  syncEntityTags: vi.fn(async () => {}),
  translateToHebrew: vi.fn(async (text: string) => `he:${text}`),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse: vi.fn() }));
vi.mock("@/lib/notifications/task-assignment", () => ({ notifyTaskAssignees }));
// Run the after-response work inline so the alert can be asserted.
vi.mock("@/lib/after-response", () => ({ runAfterResponse: (_label: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/tags", () => ({
  syncEntityTags,
  parseTagIds: (value: unknown) => (Array.isArray(value) ? value : []),
}));
vi.mock("@/lib/i18n/translateToHebrew", () => ({ translateToHebrew }));

import { POST } from "@/app/api/tasks/update/route";

type Call = { table: string; op: "select" | "update" | "delete" | "insert"; values?: unknown; filters: unknown[][] };

const TASK = {
  id: "t1",
  subject: "לתקן דלת",
  assigned_user_id: "u2",
  is_private: false,
  private_owner_id: "u1",
  business_domain: "general_business",
  project_id: null,
  property_id: null,
};

function makeSupabase(opts: { task?: Record<string, unknown>; members?: string[] } = {}) {
  const task = opts.task ?? TASK;
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.update = (values: unknown) => {
      call.op = "update";
      call.values = values;
      return builder;
    };
    builder.delete = () => {
      call.op = "delete";
      return builder;
    };
    builder.insert = (values: unknown) => {
      call.op = "insert";
      call.values = values;
      return builder;
    };
    for (const m of ["eq", "in"]) {
      builder[m] = (...args: unknown[]) => {
        call.filters.push([m, ...args]);
        return builder;
      };
    }
    builder.maybeSingle = () =>
      Promise.resolve({
        data: table === "tasks" ? (call.op === "update" ? { ...task, ...(call.values as object) } : task) : null,
        error: null,
      });
    builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(
        table === "task_members" && call.op === "select"
          ? { data: (opts.members ?? []).map((user_id) => ({ user_id })), error: null }
          : { data: null, error: null }
      ).then(onF, onR);
    return builder;
  };
  return { from, calls };
}

function grant(supabase: unknown, profile: Record<string, unknown> = {}) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "office", locale: "he", ...profile } },
  });
}

function post(body: Record<string, unknown>) {
  return POST(new Request("http://test/api/tasks/update", { method: "POST", body: JSON.stringify({ id: "t1", ...body }) }));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  notifyTaskAssignees.mockClear();
  syncEntityTags.mockClear();
  translateToHebrew.mockClear();
});

describe("POST /api/tasks/update", () => {
  it("a one-field autosave is a single write — no reads, no members, no tags", async () => {
    const sb = makeSupabase();
    grant(sb);
    const res = await post({ due_date: "2026-11-01" });
    expect(res.status).toBe(200);
    expect(sb.calls).toEqual([{ table: "tasks", op: "update", values: { due_date: "2026-11-01" }, filters: [["eq", "id", "t1"]] }]);
    expect(syncEntityTags).not.toHaveBeenCalled();
    expect(notifyTaskAssignees).not.toHaveBeenCalled();
  });

  it("does not re-alert the existing assignee when some other field is saved", async () => {
    grant(makeSupabase());
    await post({ priority: "high" });
    expect(notifyTaskAssignees).not.toHaveBeenCalled();
  });

  it("alerts a NEW assignee", async () => {
    grant(makeSupabase());
    await post({ assigned_user_id: "u9" });
    expect(notifyTaskAssignees).toHaveBeenCalledWith("t1", "לתקן דלת", ["u9"]);
  });

  it("diffs members: deletes only the removed, inserts only the added, alerts only the added", async () => {
    const sb = makeSupabase({ members: ["a", "b"] });
    grant(sb);
    await post({ member_ids: ["b", "c"] });
    const memberWrites = sb.calls.filter((c) => c.table === "task_members" && c.op !== "select");
    expect(memberWrites).toEqual([
      { table: "task_members", op: "delete", filters: [["eq", "task_id", "t1"], ["in", "user_id", ["a"]]] },
      { table: "task_members", op: "insert", values: [{ task_id: "t1", user_id: "c" }], filters: [] },
    ]);
    expect(notifyTaskAssignees).toHaveBeenCalledWith("t1", "לתקן דלת", ["c"]);
  });

  it("an unchanged member list writes nothing", async () => {
    const sb = makeSupabase({ members: ["a", "b"] });
    grant(sb);
    await post({ member_ids: ["b", "a"] });
    expect(sb.calls.filter((c) => c.table === "task_members" && c.op !== "select")).toEqual([]);
  });

  it("never stores the assignee as a member row", async () => {
    const sb = makeSupabase({ members: ["u2"] });
    grant(sb);
    await post({ member_ids: ["u2", "c"] });
    const writes = sb.calls.filter((c) => c.table === "task_members" && c.op !== "select");
    expect(writes).toEqual([
      { table: "task_members", op: "delete", filters: [["eq", "task_id", "t1"], ["in", "user_id", ["u2"]]] },
      { table: "task_members", op: "insert", values: [{ task_id: "t1", user_id: "c" }], filters: [] },
    ]);
  });

  it("only the task's creator may change its privacy", async () => {
    grant(makeSupabase({ task: { ...TASK, private_owner_id: "someone-else" } }));
    const res = await post({ is_private: true });
    expect(res.status).toBe(403);
  });

  it("translates an Arabic writer's new name to Hebrew", async () => {
    const sb = makeSupabase();
    grant(sb, { locale: "ar" });
    await post({ subject: "اصلاح الباب" });
    const write = sb.calls.find((c) => c.table === "tasks" && c.op === "update");
    expect(write?.values).toEqual({ subject: "اصلاح الباب", subject_he: "he:اصلاح الباب" });
  });

  it("rejects a domain that needs a project when none is given", async () => {
    grant(makeSupabase());
    const res = await post({ business_domain: "logistics_projects", project_id: null, property_id: null });
    expect(res.status).toBe(400);
  });
});
