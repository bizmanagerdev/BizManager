import { describe, it, expect, vi, beforeEach } from "vitest";

// Status changes and alerts saved on the phone first (owner, 2026-10-08): a
// project's status, a quote approved and a project's agreed price change the
// row on the phone and go up through their own route — only what they change,
// never the rest of the row as the phone last saw it; a reminder marked done,
// snoozed or dismissed changes on the phone exactly as the action route
// changes it on the server (the same rules, lib/reminders/reminder-action.ts)
// and the action goes up to that route.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
const { readyDeviceSaves } = vi.hoisted(() => ({ readyDeviceSaves: vi.fn() }));
vi.mock("@/lib/powersync/store", () => ({ readyDeviceSaves }));

import { POST as updateStatus } from "@/app/api/projects/update-status/route";
import { POST as reminderAction } from "@/app/api/reminders/action/route";
import { requestForChange } from "@/lib/powersync/local-writes";
import { deviceProjectSaves } from "@/lib/projects/device-project-saves";
import { reminderActionOnDevice } from "@/lib/reminders/device-reminder-saves";
import { reminderActionUpdates } from "@/lib/reminders/reminder-action";

const ID = "11111111-2222-4333-8444-555555555555";

/** A fake device copy: the rows it holds (by table, by id), and every write. */
function fakeCopy(rows: { projects?: Record<string, object>; reminders?: Record<string, object> } = {}) {
  const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({}));
  const getOptional = vi.fn(async (sql: string, params?: unknown[]) => {
    const id = String(params?.[0]);
    if (sql.includes("FROM projects")) return rows.projects?.[id] ?? null;
    if (sql.includes("FROM reminders")) return rows.reminders?.[id] ?? null;
    return null;
  });
  readyDeviceSaves.mockReturnValue({ db: { execute, getOptional }, viewerId: "u1" });
  return { execute };
}

/** What an UPDATE on the device set, by column. */
function written(execute: ReturnType<typeof fakeCopy>["execute"], index = 0) {
  const [sql, params] = execute.mock.calls[index] as [string, unknown[]];
  const columns = [...sql.slice(0, sql.indexOf(" WHERE ")).matchAll(/(\w+) = \?/g)].map((m) => m[1]);
  return { table: sql.split(" ")[1], id: params[params.length - 1], set: Object.fromEntries(columns.map((c, i) => [c, params[i]])) };
}

/** The queued change a write makes (PowerSync records the columns it changed). */
const change = (table: string, set: Record<string, unknown>) => ({ table, op: "PATCH", id: ID, opData: set }) as never;

const noCurrent = vi.fn(async () => null);

function grant(supabase: unknown, profile = { id: "u1", role: "admin" }) {
  requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase, user: { id: "auth-1" }, profile } });
}

const post = (route: (req: Request) => Promise<Response>, body: unknown) =>
  route(new Request("http://test/api", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  requireRouteAccess.mockReset();
  readyDeviceSaves.mockReset();
  noCurrent.mockClear();
});

describe("a project's status, quote and price — on the phone first", () => {
  it("a status change: the row on the phone, then only {id, status} to the status route", async () => {
    const { execute } = fakeCopy({ projects: { [ID]: { id: ID } } });
    expect(await deviceProjectSaves("projectPage")!.change(ID, { kind: "status", status: "completed" })).toBe(true);
    const { table, id, set } = written(execute);
    expect([table, id]).toEqual(["projects", ID]);
    expect(set).toMatchObject({ status: "completed" });
    expect(Object.keys(set)).toEqual(["status", "updated_at", "_extras"]);

    const request = await requestForChange(change("projects", set), noCurrent);
    expect(request).toEqual({ kind: "project-status", url: "/api/projects/update-status", body: { id: ID, status: "completed" } });
    // Not the whole row as the phone saw it.
    expect(noCurrent).not.toHaveBeenCalled();
  });

  it("a quote approved: planned, with its price, through the approve-quote route", async () => {
    const { execute } = fakeCopy({ projects: { [ID]: { id: ID } } });
    await deviceProjectSaves("projects")!.change(ID, { kind: "approve-quote", agreed_base_price: 4500 });
    const { set } = written(execute);
    expect(set).toMatchObject({ status: "planned", agreed_base_price: 4500, actual_price: 4500 });
    expect(await requestForChange(change("projects", set), noCurrent)).toEqual({
      kind: "project-approve-quote",
      url: "/api/projects/approve-quote",
      body: { id: ID, agreed_base_price: 4500 },
    });
  });

  it("the agreed price: set (cleared is 0, as the route keeps it), through its own route", async () => {
    const { execute } = fakeCopy({ projects: { [ID]: { id: ID } } });
    const saves = deviceProjectSaves("projectPage")!;
    await saves.change(ID, { kind: "agreed-price", agreed_base_price: 1200 });
    await saves.change(ID, { kind: "agreed-price", agreed_base_price: null });
    expect(written(execute, 0).set).toMatchObject({ agreed_base_price: 1200, actual_price: 1200 });
    expect(written(execute, 1).set).toMatchObject({ agreed_base_price: 0, actual_price: 0 });
    expect(await requestForChange(change("projects", written(execute, 1).set), noCurrent)).toEqual({
      kind: "project-price",
      url: "/api/projects/update-agreed-base-price",
      body: { project_id: ID, agreed_base_price: null },
    });
  });

  it("a project the phone doesn't have: false — saved on the server instead", async () => {
    const { execute } = fakeCopy();
    expect(await deviceProjectSaves()!.change(ID, { kind: "status", status: "active" })).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("an edit in the project form after it still goes up as the whole row", async () => {
    const current = vi.fn(async () => ({ id: ID, customer_id: "c1", name: "חדש", status: "active" }));
    const request = await requestForChange(change("projects", { name: "חדש", updated_at: "x" }), current);
    expect(request).toMatchObject({ kind: "project-update", url: "/api/projects/update" });
    expect(current).toHaveBeenCalledWith(ID, "projects");
  });
});

/** A route's Supabase client: `.from(t).update(v).eq(c, id).select(cols)` answers `result`. */
function updateClient(result: { data: unknown; error: unknown }, read?: unknown) {
  const updates: unknown[] = [];
  const from = () => {
    const builder: Record<string, unknown> = {};
    let updating = false;
    builder.update = (values: unknown) => {
      updating = true;
      updates.push(values);
      return builder;
    };
    builder.eq = () => builder;
    builder.select = () => (updating ? Promise.resolve(result) : builder);
    builder.maybeSingle = () => Promise.resolve({ data: read ?? null, error: null });
    return builder;
  };
  return { supabase: { from }, updates };
}

describe("the status route", () => {
  it("sets the status, and only it", async () => {
    const { supabase, updates } = updateClient({ data: [{ id: ID }], error: null });
    grant(supabase);
    const res = await post(updateStatus, { id: ID, status: "on_hold" });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ status: "on_hold" }]);
  });

  it("refuses a status that isn't one, and a project it may not change", async () => {
    const { supabase } = updateClient({ data: [], error: null });
    grant(supabase);
    expect((await post(updateStatus, { id: ID, status: "done" })).status).toBe(400);
    expect((await post(updateStatus, { status: "active" })).status).toBe(400);
    // RLS (a worker, or gone): nothing updated.
    expect((await post(updateStatus, { id: ID, status: "active" })).status).toBe(404);
  });
});

describe("a reminder acted on — on the phone first", () => {
  it("done: closed on the phone as the server closes it, and the action goes up", async () => {
    const { execute } = fakeCopy({ reminders: { [ID]: { source: "manual" } } });
    expect(await reminderActionOnDevice(ID, "done")).toBe(true);
    const { table, set } = written(execute);
    expect(table).toBe("reminders");
    expect(set).toMatchObject({ status: "done", updated_by: "u1" });
    expect(typeof set.resolved_at).toBe("string");
    expect(await requestForChange(change("reminders", set), noCurrent)).toEqual({
      kind: "reminder-action",
      url: "/api/reminders/action",
      body: { id: ID, action: "done" },
    });
  });

  it("a system alert marked done: auto-resolved, as on the server", async () => {
    const { execute } = fakeCopy({ reminders: { [ID]: { source: "system" } } });
    await reminderActionOnDevice(ID, "done");
    expect(written(execute).set).toMatchObject({ status: "auto_resolved" });
  });

  it("snoozed: until then, on the phone — the time goes up with it", async () => {
    const { execute } = fakeCopy({ reminders: { [ID]: { source: "manual" } } });
    const until = new Date(Date.now() + 3_600_000).toISOString();
    expect(await reminderActionOnDevice(ID, "snooze", until)).toBe(true);
    const { set } = written(execute);
    expect(set).toMatchObject({ snoozed_until: until, snoozed_by: "u1" });
    expect((await requestForChange(change("reminders", set), noCurrent))?.body).toEqual({
      id: ID,
      action: "snooze",
      snooze_until: until,
    });
  });

  it("a snooze time already past: not on the phone — the server says why", async () => {
    const { execute } = fakeCopy({ reminders: { [ID]: { source: "manual" } } });
    expect(await reminderActionOnDevice(ID, "snooze", new Date(Date.now() - 1000).toISOString())).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("dismissed: a manual reminder is cancelled; a system alert waits until tomorrow morning", async () => {
    const now = new Date("2026-10-08T10:00:00.000Z");
    expect(reminderActionUpdates({ source: "manual" }, "dismiss", { userId: "u1", now })).toEqual({
      updates: { updated_by: "u1", updated_at: now.toISOString(), status: "cancelled", resolved_at: now.toISOString() },
    });
    expect(reminderActionUpdates({ source: "system" }, "dismiss", { userId: "u1", now })).toEqual({
      updates: { updated_by: "u1", updated_at: now.toISOString(), snoozed_until: "2026-10-09T04:00:00.000Z", snoozed_by: "u1" },
    });
  });

  it("a reminder the phone doesn't hold, or someone whose dashboard comes from the server: false — done on the server", async () => {
    fakeCopy();
    expect(await reminderActionOnDevice(ID, "done")).toBe(false);
    readyDeviceSaves.mockReturnValue(null);
    expect(await reminderActionOnDevice(ID, "done")).toBe(false);
  });

  it("a reminder change with no action recorded sends nothing", async () => {
    expect(await requestForChange(change("reminders", { status: "done" }), noCurrent)).toBeNull();
    expect(await requestForChange({ table: "reminders", op: "PUT", id: ID, opData: {} } as never, noCurrent)).toBeNull();
  });
});

describe("the action route (the same rules)", () => {
  it("closes a system alert as auto-resolved, for someone it's aimed at", async () => {
    const { supabase, updates } = updateClient(
      { data: [{ id: ID }], error: null },
      { id: ID, source: "system", assigned_to: null, created_by: null, audience_role: "admin" }
    );
    grant(supabase);
    const res = await post(reminderAction, { id: ID, action: "done" });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ status: "auto_resolved", updated_by: "u1" });
  });

  it("refuses a past snooze time, an unknown action, and someone it isn't for", async () => {
    const { supabase } = updateClient({ data: [{ id: ID }], error: null }, { id: ID, source: "manual", assigned_to: "u1" });
    grant(supabase);
    expect((await post(reminderAction, { id: ID, action: "snooze", snooze_until: "2020-01-01T00:00:00Z" })).status).toBe(400);
    expect((await post(reminderAction, { id: ID, action: "archive" })).status).toBe(400);
    const other = updateClient({ data: [{ id: ID }], error: null }, { id: ID, source: "manual", assigned_to: "u2", created_by: "u2" });
    grant(other.supabase);
    expect((await post(reminderAction, { id: ID, action: "done" })).status).toBe(403);
  });
});
