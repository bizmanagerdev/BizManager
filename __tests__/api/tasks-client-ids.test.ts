import { describe, it, expect, vi, beforeEach } from "vitest";

// A task or comment written on the phone first arrives with the id the app
// gave it: the routes keep that id (so it's the same row the phone already
// shows), ignore anything that isn't a proper id, and — when the very same
// row arrives again (its first answer lost) — answer with it instead of
// refusing. And a reminder's note can be cleared.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse: vi.fn() }));
vi.mock("@/lib/tags", () => ({ parseTagIds: () => [], syncEntityTags: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/task-assignment", () => ({ notifyTaskAssignees: vi.fn() }));
vi.mock("@/lib/after-response", () => ({ runAfterResponse: vi.fn() }));
vi.mock("@/lib/i18n/translateToHebrew", () => ({ translateToHebrew: vi.fn(async () => null) }));

import { POST as createTask } from "@/app/api/tasks/create/route";
import { POST as addComment } from "@/app/api/tasks/add-comment/route";
import { POST as updateReminder } from "@/app/api/tasks/reminders/update/route";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

/** A Supabase stand-in: every call recorded; `answer` decides each query's result. */
function makeSupabase(answer: (table: string, calls: Call[]) => Resp) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const mine: Call[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "or", "order", "limit", "in"]) {
      builder[method] = (...args: unknown[]) => {
        const call = { table, method, args };
        mine.push(call);
        calls.push(call);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(answer(table, mine));
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(answer(table, mine)).then(onF, onR);
    return builder;
  };
  return { supabase: { from }, calls };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "office", locale: "he", full_name: "אני" } },
  });
}

const post = (handler: (req: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://test/api", { method: "POST", body: JSON.stringify(body) }));

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/tasks/create with the app's id", () => {
  it("keeps a proper id; ignores anything else", async () => {
    const { supabase, calls } = makeSupabase((table, mine) =>
      mine.some((c) => c.method === "insert") ? { data: { id: ID, status: "todo" }, error: null } : { data: null, error: null }
    );
    grant(supabase);
    const res = await post(createTask, { id: ID.toUpperCase(), subject: "להתקשר" });
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.method === "insert");
    expect((insert?.args[0] as { id?: string }).id).toBe(ID);

    const other = makeSupabase((_t, mine) =>
      mine.some((c) => c.method === "insert") ? { data: { id: "db-made" }, error: null } : { data: null, error: null }
    );
    grant(other.supabase);
    await post(createTask, { id: "not-an-id; drop table", subject: "להתקשר" });
    expect(other.calls.find((c) => c.method === "insert")?.args[0]).not.toHaveProperty("id");
  });

  it("the same task again (its first answer was lost): answered with it, not refused", async () => {
    const { supabase } = makeSupabase((_table, mine) => {
      if (mine.some((c) => c.method === "insert")) return { data: null, error: { code: "23505", message: "duplicate key" } };
      if (mine.some((c) => c.method === "eq" && c.args[0] === "id")) return { data: { id: ID, subject: "להתקשר" }, error: null };
      return { data: null, error: null };
    });
    grant(supabase);
    const res = await post(createTask, { id: ID, subject: "להתקשר" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ task: { id: ID, subject: "להתקשר" } });
  });

  it("an id that's someone else's row (not readable): still a refusal", async () => {
    const { supabase } = makeSupabase((_table, mine) =>
      mine.some((c) => c.method === "insert") ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: null, error: null }
    );
    grant(supabase);
    expect((await post(createTask, { id: ID, subject: "להתקשר" })).status).toBe(400);
  });
});

describe("POST /api/tasks/add-comment with the app's id", () => {
  it("keeps it, and answers a repeat with the comment that's there", async () => {
    const first = makeSupabase(() => ({ data: { id: ID, author_id: "prof-1", body: "בוצע", body_he: null, created_at: "x" }, error: null }));
    grant(first.supabase);
    expect((await post(addComment, { id: ID, task_id: "t1", message: "בוצע" })).status).toBe(200);
    expect((first.calls.find((c) => c.method === "insert")?.args[0] as { id?: string }).id).toBe(ID);

    const again = makeSupabase((_table, mine) =>
      mine.some((c) => c.method === "insert")
        ? { data: null, error: { code: "23505", message: "duplicate key" } }
        : { data: { id: ID, author_id: "prof-1", body: "בוצע", body_he: null, created_at: "x" }, error: null }
    );
    grant(again.supabase);
    const res = await post(addComment, { id: ID, task_id: "t1", message: "בוצע" });
    expect(res.status).toBe(200);
    expect((await res.json()).comment).toMatchObject({ id: ID, author_name: "אני" });
  });
});

describe("POST /api/tasks/reminders/update", () => {
  it("a note emptied in the form (sent as null) is cleared", async () => {
    const { supabase, calls } = makeSupabase(() => ({ data: [{ id: "r1" }], error: null }));
    grant(supabase);
    await post(updateReminder, { id: "r1", content: null });
    expect(calls.find((c) => c.method === "update")?.args[0]).toMatchObject({ content: null });
  });
});
