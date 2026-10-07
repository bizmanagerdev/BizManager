import { describe, it, expect, vi, beforeEach } from "vitest";

// A customer saved on the phone first (owner, 2026-10-07): the phone writes
// the same row the server would make, and sends it — with its contacts,
// branches and tags — as ONE change; the route keeps the app's id, answers a
// repeat (its first answer lost) with the customer it already made, and
// creates the contacts and branches right after it.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));
const { syncEntityTags } = vi.hoisted(() => ({ syncEntityTags: vi.fn(async () => {}) }));
vi.mock("@/lib/tags", () => ({ parseTagIds: (v: unknown) => (Array.isArray(v) ? v : []), syncEntityTags }));

import { POST as createCustomer } from "@/app/api/customers/create/route";
import { createCustomerOnDevice, requestForChange } from "@/lib/powersync/local-writes";
import type { NewCustomerInput } from "@/lib/customers/new-customer";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function makeSupabase(answer: (table: string, calls: Call[]) => Resp) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const mine: Call[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "in"]) {
      builder[method] = (...args: unknown[]) => {
        const call = { table, method, args };
        mine.push(call);
        calls.push(call);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(answer(table, mine));
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(answer(table, mine)).then(onF, onR);
    return builder;
  };
  return { supabase: { from }, calls };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase, user: { id: "auth-1" } } });
}

const post = (body: unknown) =>
  createCustomer(new Request("http://test/api/customers/create", { method: "POST", body: JSON.stringify(body) }));

const ID = "11111111-2222-4333-8444-555555555555";

const input: NewCustomerInput = {
  name: " משה כהן ",
  name_for_invoice: null,
  registration_number: null,
  phone: "+972 52-123-4567",
  whatsapp: null,
  email: null,
  city: "אלעד",
  street: "הרב קוק 5",
  notes: null,
  requires_prepayment: false,
  linked_user_id: null,
  tag_ids: ["tag-1"],
  contacts: [
    { full_name: "רבקה", role: "מזכירה", phone: null, email: null, whatsapp: null, notes: null, is_primary: true, active: true },
    { full_name: "  ", role: null, phone: null, email: null, whatsapp: null, notes: null, is_primary: false, active: true },
  ],
  branches: [{ name: "סניף צפון", address: null, phone: "0521234567", active: true }],
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  syncEntityTags.mockClear();
});

describe("a customer saved on the phone first", () => {
  it("the phone writes the row the server makes, with what goes up with it", async () => {
    const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({}));
    await createCustomerOnDevice({ execute } as never, { id: ID, input });
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/^INSERT INTO customers \(id, name, name_for_invoice, .*_extras\)/);
    const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(", ");
    const row = Object.fromEntries(columns.map((c, i) => [c, params[i]]));
    expect(row).toMatchObject({
      id: ID,
      name: "משה כהן",
      name_for_invoice: "משה כהן",
      phone: "0521234567",
      city: "אלעד",
      address: "אלעד | הרב קוק 5",
      active: 1,
      requires_prepayment: 0,
    });

    // …and the queued change becomes one call to the route, carrying it all.
    const request = await requestForChange({ table: "customers", op: "PUT", id: ID, opData: row } as never, async () => null);
    expect(request?.kind).toBe("customer-create");
    expect(request?.url).toBe("/api/customers/create");
    expect(request?.body).toMatchObject({
      id: ID,
      name: "משה כהן",
      city: "אלעד",
      address: "הרב קוק 5",
      requires_prepayment: false,
      tag_ids: ["tag-1"],
      contacts: [expect.objectContaining({ full_name: "רבקה", is_primary: true })],
      branches: [expect.objectContaining({ name: "סניף צפון" })],
    });
    expect((request?.body.contacts as unknown[]).length).toBe(1); // the nameless one is dropped
  });

  it("the route keeps the app's id, then creates the contacts and branches with it", async () => {
    const { supabase, calls } = makeSupabase((table, mine) => {
      if (table === "customers" && mine.some((c) => c.method === "insert")) return { data: { id: ID, name: "משה כהן" }, error: null };
      if (table === "contacts") return { data: [{ id: "c1", full_name: "רבקה" }], error: null };
      return { data: null, error: null };
    });
    grant(supabase);
    const res = await post({ id: ID, name: "משה כהן", city: "אלעד", address: "הרב קוק 5", contacts: input.contacts, branches: input.branches });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { customer: { id: string }; contacts?: unknown[] };
    expect(body.customer.id).toBe(ID);
    expect(body.contacts).toHaveLength(1);
    const customerInsert = calls.find((c) => c.table === "customers" && c.method === "insert")?.args[0] as Record<string, unknown>;
    expect(customerInsert).toMatchObject({ id: ID, address: "אלעד | הרב קוק 5" });
    const contactInsert = calls.find((c) => c.table === "contacts" && c.method === "insert")?.args[0] as Record<string, unknown>[];
    expect(contactInsert).toEqual([expect.objectContaining({ customer_id: ID, full_name: "רבקה", is_primary: true })]);
    const branchInsert = calls.find((c) => c.table === "customer_branches" && c.method === "insert")?.args[0] as Record<string, unknown>[];
    expect(branchInsert).toEqual([expect.objectContaining({ customer_id: ID, name: "סניף צפון" })]);
  });

  it("the same customer again (its first answer lost): answered with it — no second contacts", async () => {
    const { supabase, calls } = makeSupabase((table, mine) => {
      if (table === "customers" && mine.some((c) => c.method === "insert")) return { data: null, error: { code: "23505", message: "duplicate key" } };
      if (table === "customers" && mine.some((c) => c.method === "eq")) return { data: { id: ID, name: "משה כהן" }, error: null };
      return { data: null, error: null };
    });
    grant(supabase);
    const res = await post({ id: ID, name: "משה כהן", city: "אלעד", contacts: input.contacts });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { customer: { id: string } }).customer.id).toBe(ID);
    expect(calls.some((c) => c.table === "contacts")).toBe(false);
  });

  it("without an id (the server path): as before — the database picks it", async () => {
    const { supabase, calls } = makeSupabase((table, mine) =>
      table === "customers" && mine.some((c) => c.method === "insert") ? { data: { id: "db-made" }, error: null } : { data: null, error: null }
    );
    grant(supabase);
    const res = await post({ name: "לקוח", city: "אלעד" });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.method === "insert")?.args[0]).not.toHaveProperty("id");
  });
});
