import { describe, it, expect, vi, beforeEach } from "vitest";

// A customer's address picked from Google (owner, 2026-10-16: one address
// type everywhere). Every save writes the picked address's own fields AND the
// old one-line address and city, so everything that reads those keeps
// working; a save that didn't touch the address leaves it exactly as it was;
// "no address" is allowed; and an undo puts back an address saved before the
// picker.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));
vi.mock("@/lib/tags", () => ({ parseTagIds: (v: unknown) => (Array.isArray(v) ? v : []), syncEntityTags: vi.fn(async () => {}) }));

import { POST as createCustomer } from "@/app/api/customers/create/route";
import { POST as updateCustomer } from "@/app/api/customers/update/route";
import { POST as createBranch } from "@/app/api/customer-branches/create/route";
import { createCustomerOnDevice, requestForChange } from "@/lib/powersync/local-writes";
import type { NewCustomerInput } from "@/lib/customers/new-customer";
import type { StructuredAddress } from "@/lib/address/structured";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function makeSupabase() {
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
    const answer = (): Resp =>
      table === "customers"
        ? { data: { id: "c1", name: "משה" }, error: null }
        : table === "customer_branches"
          ? { data: { id: "b1" }, error: null }
          : { data: null, error: null };
    builder.maybeSingle = () => Promise.resolve(answer());
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(answer()).then(onF, onR);
    return builder;
  };
  return { supabase: { from }, calls };
}

let calls: Call[] = [];
beforeEach(() => {
  const made = makeSupabase();
  calls = made.calls;
  requireRouteAccess.mockReset();
  requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: made.supabase, user: { id: "auth-1" }, profile: { role: "admin" } } });
});

const req = (url: string, body: unknown) => new Request(`http://test${url}`, { method: "POST", body: JSON.stringify(body) });
const written = (table: string, method: "insert" | "update") =>
  calls.find((c) => c.table === table && c.method === method)?.args[0] as Record<string, unknown>;

const PICKED: StructuredAddress = {
  city: "בית שמש",
  street: "יחזקאל הנביא",
  houseNumber: "27",
  unit: "בחניה",
  lat: 31.7037704,
  lng: 34.9863334,
  placeId: "ChIJ-yechezkel-27",
  formatted: "יחזקאל הנביא 27, בית שמש",
};
const PICKED_COLUMNS = {
  addr_city: "בית שמש",
  addr_street: "יחזקאל הנביא",
  addr_house_number: "27",
  addr_unit: "בחניה",
  addr_lat: 31.7037704,
  addr_lng: 34.9863334,
  addr_place_id: "ChIJ-yechezkel-27",
  addr_formatted: "יחזקאל הנביא 27, בית שמש",
};

describe("creating a customer", () => {
  it("writes the picked address and, beside it, the old line and city — the unit stays out of the line", async () => {
    const res = await createCustomer(req("/api/customers/create", { name: "משה", phone: "0521234567", structured_address: PICKED }));
    expect(res.status).toBe(200);
    expect(written("customers", "insert")).toMatchObject({
      ...PICKED_COLUMNS,
      city: "בית שמש",
      address: "בית שמש | יחזקאל הנביא 27",
    });
  });

  it("every customer has a city: just the city is enough, none at all is refused", async () => {
    const cityOnly = { ...PICKED, street: "", houseNumber: "", unit: "", formatted: "בית שמש", placeId: "ChIJ-beit-shemesh" };
    const res = await createCustomer(req("/api/customers/create", { name: "משה", phone: "0521234567", structured_address: cityOnly }));
    expect(res.status).toBe(200);
    expect(written("customers", "insert")).toMatchObject({ city: "בית שמש", address: "בית שמש", addr_city: "בית שמש", addr_street: null });

    calls.length = 0;
    const none = await createCustomer(req("/api/customers/create", { name: "משה", phone: "0521234567", structured_address: null }));
    expect(none.status).toBe(400);
    expect(calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("a request from before the picker still needs a city, and is saved as before", async () => {
    expect((await createCustomer(req("/api/customers/create", { name: "משה" }))).status).toBe(400);
    await createCustomer(req("/api/customers/create", { name: "משה", city: "אלעד", address: "הרב קוק 5" }));
    const row = written("customers", "insert");
    expect(row).toMatchObject({ city: "אלעד", address: "אלעד | הרב קוק 5" });
    expect(row).not.toHaveProperty("addr_city");
  });

  it("a branch sent with it keeps its picked address too", async () => {
    await createCustomer(
      req("/api/customers/create", {
        name: "משה",
        structured_address: PICKED,
        branches: [{ name: "צפון", phone: null, active: true, structured_address: { ...PICKED, unit: "" } }],
      })
    );
    const branches = written("customer_branches", "insert") as unknown as Record<string, unknown>[];
    expect(branches[0]).toMatchObject({ customer_id: "c1", name: "צפון", address: "בית שמש | יחזקאל הנביא 27", addr_street: "יחזקאל הנביא" });
    expect(branches[0]).not.toHaveProperty("structured_address");
  });

  it("a made-up place id or a lone coordinate is dropped, not written", async () => {
    await createCustomer(
      req("/api/customers/create", { name: "משה", structured_address: { ...PICKED, placeId: "../../x", lng: null } })
    );
    expect(written("customers", "insert")).toMatchObject({ addr_place_id: null, addr_lat: null, addr_lng: null, addr_street: "יחזקאל הנביא" });
  });
});

describe("editing a customer", () => {
  it("a changed address writes its fields, city and old line", async () => {
    await updateCustomer(req("/api/customers/update", { id: "c1", name: "משה", structured_address: PICKED }));
    expect(written("customers", "update")).toMatchObject({ ...PICKED_COLUMNS, city: "בית שמש", address: "בית שמש | יחזקאל הנביא 27" });
  });

  it("an edit that didn't touch the address leaves every address column alone", async () => {
    await updateCustomer(req("/api/customers/update", { id: "c1", name: "משה", notes: "טלפון לפני" }));
    const patch = written("customers", "update");
    expect(patch).toMatchObject({ name: "משה", notes: "טלפון לפני" });
    for (const key of ["address", "city", "addr_city", "addr_street", "addr_lat"]) expect(patch).not.toHaveProperty(key);
  });

  it("an edit can't leave a customer with no city", async () => {
    const res = await updateCustomer(req("/api/customers/update", { id: "c1", structured_address: null }));
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });

  it("an undo puts back an address saved before the picker: the old line and city, the new fields cleared", async () => {
    await updateCustomer(
      req("/api/customers/update", {
        id: "c1",
        structured_address: null,
        address: "בית שמש | יחזקאל הנביא 27 בחניה",
        city: "בית שמש",
      })
    );
    expect(written("customers", "update")).toMatchObject({
      address: "בית שמש | יחזקאל הנביא 27 בחניה",
      city: "בית שמש",
      addr_city: null,
      addr_street: null,
    });
  });

  // Owner, 2026-10-18: an address Google couldn't find stays marked until a
  // real one is picked — an undo of that pick puts the mark back.
  it("an undo puts back a 'not found on Google Maps' mark too", async () => {
    await updateCustomer(
      req("/api/customers/update", { id: "c1", structured_address: null, address: "ביתר | הרב קוק 5", city: "ביתר עילית", addr_not_found: true })
    );
    expect(written("customers", "update")).toMatchObject({ address: "ביתר | הרב קוק 5", addr_place_id: "not_found", addr_city: null });
  });

  it("a picked address replaces the mark", async () => {
    await updateCustomer(req("/api/customers/update", { id: "c1", structured_address: PICKED, addr_not_found: true }));
    expect(written("customers", "update")).toMatchObject({ addr_place_id: PICKED_COLUMNS.addr_place_id });
  });
});

describe("a branch on its own", () => {
  it("is created with its picked address", async () => {
    await createBranch(req("/api/customer-branches/create", { customer_id: "c1", name: "צפון", structured_address: PICKED }));
    expect(written("customer_branches", "insert")).toMatchObject({ name: "צפון", address: "בית שמש | יחזקאל הנביא 27", addr_place_id: "ChIJ-yechezkel-27" });
  });

  it("a request from before the picker keeps its typed line", async () => {
    await createBranch(req("/api/customer-branches/create", { customer_id: "c1", name: "צפון", address: " שמואל הנביא 52 " }));
    const row = written("customer_branches", "insert");
    expect(row).toMatchObject({ address: "שמואל הנביא 52" });
    expect(row).not.toHaveProperty("addr_city");
  });
});

describe("a customer saved on the phone first", () => {
  const input: NewCustomerInput = {
    name: "משה",
    name_for_invoice: null,
    registration_number: null,
    phone: "0521234567",
    whatsapp: null,
    email: null,
    city: "בית שמש",
    street: null,
    structured_address: PICKED,
    notes: null,
    requires_prepayment: false,
    linked_user_id: null,
    tag_ids: [],
    contacts: [],
    branches: [],
  };

  it("the phone's row carries the picked address, and it goes up with it", async () => {
    const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({}));
    await createCustomerOnDevice({ execute } as never, { id: "11111111-2222-4333-8444-555555555555", input });
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(", ");
    const row = Object.fromEntries(columns.map((c, i) => [c, params[i]]));
    expect(row).toMatchObject({ ...PICKED_COLUMNS, city: "בית שמש", address: "בית שמש | יחזקאל הנביא 27" });

    const request = await requestForChange({ table: "customers", op: "PUT", id: row.id, opData: row } as never, async () => null);
    expect(request?.body).toMatchObject({ structured_address: PICKED });
  });

  it("no address picked goes up as none — not as a missing city", async () => {
    const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({}));
    await createCustomerOnDevice({ execute } as never, { id: "11111111-2222-4333-8444-555555555556", input: { ...input, city: "", structured_address: null } });
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(", ");
    const row = Object.fromEntries(columns.map((c, i) => [c, params[i]]));
    const request = await requestForChange({ table: "customers", op: "PUT", id: row.id, opData: row } as never, async () => null);
    expect(request?.body).toHaveProperty("structured_address", null);
  });
});

describe("a town name in every language", () => {
  it("is written as its Hebrew name only", async () => {
    const broken = { ...PICKED, city: "• ירושלים, القدس, Jerusalem, Yerushalayim, Ерусалим" };
    await updateCustomer(req("/api/customers/update", { id: "c1", structured_address: broken }));
    expect(written("customers", "update")).toMatchObject({ city: "ירושלים", addr_city: "ירושלים", address: "ירושלים | יחזקאל הנביא 27" });
  });
});
