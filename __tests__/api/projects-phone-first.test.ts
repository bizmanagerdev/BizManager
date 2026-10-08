import { describe, it, expect, vi, beforeEach } from "vitest";

// A project saved on the phone first (owner, 2026-10-07): the phone writes the
// same row the server would make, and the queued change goes up through the
// same routes — a new one with the app's id (a repeat, its first answer lost,
// is answered with the project it already made, with no second alert); an
// edit as the whole row as it stands on the phone, so what the form doesn't
// show (the branch, the payment terms, the due date) stays as it is.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse: vi.fn() }));
const { notifyNewEntity } = vi.hoisted(() => ({ notifyNewEntity: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/new-entity", () => ({ notifyNewEntity }));
vi.mock("@/lib/after-response", () => ({ runAfterResponse: (_label: string, run: () => unknown) => run() }));
vi.mock("@/lib/settings/vat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings/vat")>()),
  getCurrentVatRate: vi.fn(async () => 0.18),
}));
const { readyDeviceSaves } = vi.hoisted(() => ({ readyDeviceSaves: vi.fn() }));
vi.mock("@/lib/powersync/store", () => ({ readyDeviceSaves }));

import { POST as createProject } from "@/app/api/projects/create/route";
import { POST as updateProject } from "@/app/api/projects/update/route";
import { requestForChange } from "@/lib/powersync/local-writes";
import { deviceProjectForEdit, deviceProjectSaves } from "@/lib/projects/device-project-saves";
import { keptProjectFields } from "@/lib/projects/project-input";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function makeSupabase(answer: (table: string, calls: Call[]) => Resp) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const mine: Call[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "eq"]) {
      builder[method] = (...args: unknown[]) => {
        const call = { table, method, args };
        mine.push(call);
        calls.push(call);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(answer(table, mine));
    return builder;
  };
  return { supabase: { from }, calls };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "admin" } },
  });
}

const post = (route: (req: Request) => Promise<Response>, body: unknown) =>
  route(new Request("http://test/api/projects", { method: "POST", body: JSON.stringify(body) }));

const ID = "11111111-2222-4333-8444-555555555555";

const form = {
  customer_id: "c1",
  branch_id: null,
  name: " הובלת משרד ",
  project_type: "moving",
  status: "planned",
  agreed_base_price: 1000,
  actual_price: 1000,
  price_includes_vat: true,
  no_charge: false,
  expenses_billed_separately: false,
  project_manager_id: "u1",
  start_date: "2026-10-08",
  end_date: null,
  payment_terms: "eom",
  due_date: null,
  notes: null,
  items_to_move: [" ארון ", ""],
  origin_address: "אלעד",
  origin_floor: "3",
  origin_has_elevator: false,
  destination_address: "בני ברק",
  destination_floor: null,
  destination_has_elevator: true,
};

/** A fake device copy: the project rows it holds, and every write. */
function fakeCopy(projects: Record<string, Record<string, unknown>> = {}) {
  const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({}));
  const getOptional = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM business_settings")) return { vat_rate: "0.18" };
    if (sql.includes("FROM projects")) return projects[String(params?.[0])] ?? null;
    return null;
  });
  readyDeviceSaves.mockReturnValue({ db: { execute, getOptional }, viewerId: "u1" });
  return { execute };
}

/** The row a write put on the device, by column. */
function written(execute: ReturnType<typeof fakeCopy>["execute"], index = 0) {
  const [sql, params] = execute.mock.calls[index] as [string, unknown[]];
  if (sql.startsWith("INSERT")) {
    const columns = ["id", ...sql.slice(sql.indexOf("(id, ") + 5, sql.indexOf(")")).split(", ")];
    return Object.fromEntries(columns.map((c, i) => [c, params[i]]));
  }
  const columns = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1]);
  return Object.fromEntries(columns.map((c, i) => [c, params[i]]));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  notifyNewEntity.mockClear();
  readyDeviceSaves.mockReset();
});

describe("a project saved on the phone first", () => {
  it("the phone writes the row the server makes; it goes up as one create, with the app's id", async () => {
    const { execute } = fakeCopy();
    const saved = await deviceProjectSaves()!.create(form);
    const row = written(execute);
    expect(row).toMatchObject({
      id: saved.id,
      name: "הובלת משרד",
      price_includes_vat: 1,
      vat_rate: 0.18,
      due_date: "2026-10-31", // end of the start's month (the "eom" terms)
      items_to_move: JSON.stringify(["ארון"]),
      origin_has_elevator: 0,
      destination_has_elevator: 1,
    });

    const request = await requestForChange({ table: "projects", op: "PUT", id: saved.id, opData: row } as never, async () => null);
    expect(request).toMatchObject({ kind: "project-create", url: "/api/projects/create" });
    expect(request?.body).toMatchObject({
      id: saved.id,
      name: "הובלת משרד",
      price_includes_vat: true,
      no_charge: false,
      items_to_move: ["ארון"],
      origin_has_elevator: false,
      destination_has_elevator: true,
      payment_terms: "eom",
      due_date: "2026-10-31",
    });
  });

  it("an edit from the project's page keeps the branch, the terms and the due date (not in that form)", async () => {
    const stored = { id: ID, ...form, name: "ישן", branch_id: "b1", payment_terms: "eom_30", due_date: "2026-12-01", price_includes_vat: 1, vat_rate: "0.17", items_to_move: '["ארון"]' };
    const { execute } = fakeCopy({ [ID]: stored });
    const pageForm = { ...form, name: "חדש" } as Record<string, unknown>;
    delete pageForm.branch_id;
    delete pageForm.payment_terms;
    delete pageForm.due_date;
    expect(await deviceProjectSaves("projectPage")!.update(ID, pageForm)).not.toBeNull();
    expect(written(execute)).toMatchObject({
      name: "חדש",
      branch_id: "b1",
      payment_terms: "eom_30",
      due_date: "2026-12-01",
      vat_rate: 0.17, // the frozen rate stays
    });
  });

  it("…and when it moves the start, the due date follows it by the project's terms", async () => {
    const stored = { id: ID, ...form, payment_terms: "eom", due_date: "2026-10-31", items_to_move: null };
    const { execute } = fakeCopy({ [ID]: stored });
    const pageForm = { ...form, start_date: "2026-11-05" } as Record<string, unknown>;
    delete pageForm.payment_terms;
    delete pageForm.due_date;
    await deviceProjectSaves("projectPage")!.update(ID, pageForm);
    expect(written(execute)).toMatchObject({ start_date: "2026-11-05", due_date: "2026-11-30" });
  });

  it("a project the phone doesn't have: null — saved on the server instead", async () => {
    fakeCopy();
    expect(await deviceProjectSaves()!.update(ID, form)).toBeNull();
  });

  it("the list's edit form reads the full project from the phone (no signal needed)", async () => {
    fakeCopy({ [ID]: { id: ID, ...form, branch_id: "b1", price_includes_vat: 1, vat_rate: "0.17", items_to_move: '["ארון"]', origin_has_elevator: 0 } });
    expect(await deviceProjectForEdit(ID)).toMatchObject({
      id: ID,
      branch_id: "b1",
      payment_terms: "eom",
      price_includes_vat: true,
      vat_rate: "0.17",
      items_to_move: ["ארון"],
      origin_has_elevator: false,
    });
    expect(await deviceProjectForEdit("missing")).toBeNull();
  });

  it("not for people whose project pages come from the server", () => {
    readyDeviceSaves.mockReturnValue(null);
    expect(deviceProjectSaves()).toBeNull();
  });

  it("an edit goes up as the whole row as it stands on the phone", async () => {
    const current = vi.fn(async () => ({ id: ID, ...form, name: "חדש", branch_id: "b1", price_includes_vat: 1, items_to_move: '["ארון"]', origin_has_elevator: null }));
    const request = await requestForChange({ table: "projects", op: "PATCH", id: ID, opData: { name: "חדש" } } as never, current);
    expect(current).toHaveBeenCalledWith(ID, "projects");
    expect(request).toMatchObject({ kind: "project-update", url: "/api/projects/update" });
    expect(request?.body).toMatchObject({ id: ID, name: "חדש", branch_id: "b1", customer_id: "c1", price_includes_vat: true, items_to_move: ["ארון"], origin_has_elevator: null });
    // Gone from the phone (deleted on the server meanwhile): nothing to send.
    expect(await requestForChange({ table: "projects", op: "PATCH", id: ID, opData: {} } as never, async () => null)).toBeNull();
  });

  it("the route keeps the app's id", async () => {
    const { supabase, calls } = makeSupabase((table, mine) =>
      table === "projects" && mine.some((c) => c.method === "insert") ? { data: { id: ID }, error: null } : { data: { id: ID, name: "הובלת משרד" }, error: null }
    );
    grant(supabase);
    const res = await post(createProject, { ...form, id: ID });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { project: { id: string } }).project.id).toBe(ID);
    const insert = calls.find((c) => c.method === "insert")?.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ id: ID, name: "הובלת משרד", vat_rate: 0.18, items_to_move: ["ארון"], due_date: "2026-10-31" });
    expect(notifyNewEntity).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", entityId: ID, name: "הובלת משרד" }));
  });

  it("the same project again (its first answer lost): answered with it — no second alert", async () => {
    const { supabase } = makeSupabase((table, mine) =>
      table === "projects" && mine.some((c) => c.method === "insert")
        ? { data: null, error: { code: "23505", message: "duplicate key" } }
        : { data: { id: ID, name: "הובלת משרד" }, error: null }
    );
    grant(supabase);
    const res = await post(createProject, { ...form, id: ID });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { project: { id: string } }).project.id).toBe(ID);
    expect(notifyNewEntity).not.toHaveBeenCalled();
  });

  it("without an id (the server path): as before — the database picks it", async () => {
    const { supabase, calls } = makeSupabase(() => ({ data: { id: "db-made" }, error: null }));
    grant(supabase);
    const res = await post(createProject, { ...form, project_type: "logistics" });
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.method === "insert")?.args[0] as Record<string, unknown>;
    expect(insert).not.toHaveProperty("id");
    // Not a move: no addresses or items.
    expect(insert).toMatchObject({ items_to_move: null, origin_address: null, destination_has_elevator: null });
  });

  it("the routes refuse what they refused before", async () => {
    grant(makeSupabase(() => ({ data: null, error: null })).supabase);
    expect((await post(createProject, { ...form, name: " " })).status).toBe(400);
    expect((await post(createProject, { ...form, project_type: "boat" })).status).toBe(400);
    expect((await post(createProject, { ...form, agreed_base_price: -5 })).status).toBe(400);
    expect((await post(updateProject, { ...form })).status).toBe(400); // no id
  });

  it("the project page's edit form, saved on the server: the branch, terms and due date stay", async () => {
    const project = { branch_id: "b1", payment_terms: "eom_30", due_date: "2026-12-01", start_date: "2026-10-08" };
    const pageForm = { ...form } as Record<string, unknown>;
    delete pageForm.branch_id;
    delete pageForm.payment_terms;
    delete pageForm.due_date;

    // Same start: all three as they are.
    expect(keptProjectFields(project, "2026-10-08")).toEqual({ branch_id: "b1", payment_terms: "eom_30", due_date: "2026-12-01" });
    const { supabase, calls } = makeSupabase((_t, mine) => ({ data: mine.some((c) => c.method === "update") ? { id: ID } : null, error: null }));
    grant(supabase);
    await post(updateProject, { id: ID, ...pageForm, start_date: "2026-10-08", ...keptProjectFields(project, "2026-10-08") });
    expect(calls.find((c) => c.method === "update")?.args[0]).toMatchObject({
      branch_id: "b1",
      payment_terms: "eom_30",
      due_date: "2026-12-01",
    });

    // The start moved: the due date follows it by the terms (end of November + 30).
    expect(keptProjectFields(project, "2026-11-03")).toEqual({ branch_id: "b1", payment_terms: "eom_30", due_date: null });
    const moved = makeSupabase((_t, mine) => ({ data: mine.some((c) => c.method === "update") ? { id: ID } : null, error: null }));
    grant(moved.supabase);
    await post(updateProject, { id: ID, ...pageForm, start_date: "2026-11-03", ...keptProjectFields(project, "2026-11-03") });
    expect(moved.calls.find((c) => c.method === "update")?.args[0]).toMatchObject({ branch_id: "b1", due_date: "2026-12-30" });

    // A project shape without them (an older caller): nothing sent for them.
    expect(keptProjectFields({ start_date: "2026-10-08" }, "2026-10-08")).toEqual({});
  });

  it("the update route writes the same row, keeping a frozen VAT rate", async () => {
    const { supabase, calls } = makeSupabase((table, mine) => {
      if (mine.some((c) => c.method === "update")) return { data: { id: ID }, error: null };
      if (table === "projects") return { data: { vat_rate: "0.17" }, error: null };
      return { data: { id: ID }, error: null };
    });
    grant(supabase);
    const res = await post(updateProject, { ...form, id: ID, branch_id: "b1" });
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.method === "update")?.args[0] as Record<string, unknown>;
    expect(update).toMatchObject({ name: "הובלת משרד", branch_id: "b1", vat_rate: 0.17, due_date: "2026-10-31" });
  });
});
