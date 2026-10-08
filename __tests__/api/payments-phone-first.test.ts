import { describe, it, expect, vi, beforeEach } from "vitest";

// Payments saved on the phone first (owner's OK 2026-10-08): a payment on an
// order, income on a project, a payment marked collected — written on the
// phone as the server writes them (the same builders), so the paid status and
// the money show at once, and sent through the same routes with the app's own
// id. The routes keep that id and answer a repeat with the payment they
// already made — the Morning receipt is issued once, when it first arrives.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));
const { tryAutoIssueReceiptForPayment } = vi.hoisted(() => ({ tryAutoIssueReceiptForPayment: vi.fn(async () => {}) }));
vi.mock("@/lib/morning/service", () => ({ tryAutoIssueReceiptForPayment }));
vi.mock("@/lib/after-response", () => ({ runAfterResponse: (_label: string, run: () => unknown) => run() }));
const { logAuditEventAfterResponse } = vi.hoisted(() => ({ logAuditEventAfterResponse: vi.fn() }));
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse }));
vi.mock("@/lib/tags", () => ({ parseTagIds: () => [], syncEntityTags: vi.fn(async () => {}) }));
vi.mock("@/lib/settings/vat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings/vat")>()),
  getCurrentVatRate: vi.fn(async () => 0.18),
}));
const { readyDeviceSaves } = vi.hoisted(() => ({ readyDeviceSaves: vi.fn() }));
vi.mock("@/lib/powersync/store", () => ({ readyDeviceSaves }));

import { POST as createOrderPayment } from "@/app/api/orders/payments/create/route";
import { POST as createPayment } from "@/app/api/payments/create/route";
import { isCarriedChange, requestForChange } from "@/lib/powersync/local-writes";
import { devicePaymentSaves } from "@/lib/payments/device-payment-saves";
import { orderPaymentFrom } from "@/lib/orders/order-payment-input";

const ORDER = "11111111-2222-4333-8444-555555555555";
const PROJECT = "22222222-3333-4444-8555-666666666666";
const PAY = "66666666-7777-4888-9999-aaaaaaaaaaaa";

/** A fake device copy: the rows it holds, and every write. */
function fakeCopy(rows: { orders?: string[]; projects?: Record<string, { project_type: string }>; payments?: string[]; vat?: string } = {}) {
  const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({}));
  const getOptional = vi.fn(async (sql: string, params?: unknown[]) => {
    const id = String(params?.[0]);
    if (sql.includes("FROM business_settings")) return { vat_rate: rows.vat ?? "0.17" };
    if (sql.includes("FROM orders")) return rows.orders?.includes(id) ? { id } : null;
    if (sql.includes("FROM projects")) return rows.projects?.[id] ?? null;
    if (sql.includes("FROM payments")) return rows.payments?.includes(id) ? { id } : null;
    return null;
  });
  readyDeviceSaves.mockReturnValue({ db: { execute, getOptional }, viewerId: "u1" });
  return { execute };
}

/** The row an INSERT or UPDATE put on the device, by column. */
function written(execute: ReturnType<typeof fakeCopy>["execute"], index = 0) {
  const [sql, params] = execute.mock.calls[index] as [string, unknown[]];
  if (sql.startsWith("INSERT")) {
    const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(", ");
    return Object.fromEntries(columns.map((c, i) => [c, params[i]]));
  }
  const columns = [...sql.slice(0, sql.indexOf(" WHERE ")).matchAll(/(\w+) = \?/g)].map((m) => m[1]);
  return { ...Object.fromEntries(columns.map((c, i) => [c, params[i]])), id: params[params.length - 1] };
}

/** The queued change a write makes (its own columns, as PowerSync records them). */
const queued = (op: "PUT" | "PATCH", row: Record<string, unknown>) =>
  ({ table: "payments", op, id: String(row.id), opData: Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id")) }) as never;

const orderPayment = {
  order_id: ORDER,
  entry_type: "payment",
  amount_total: 250,
  payment_date: "2026-10-08",
  payment_method: "check",
  due_date: "2026-11-01",
  check_number: " 1234 ",
  notes: " מקדמה ",
};

/** A route client: answers each table's read, records inserts. */
function routeClient(answers: {
  insert?: { data: unknown; error: unknown };
  readById?: Record<string, unknown>;
  order?: unknown;
  project?: unknown;
  orderPayments?: unknown[];
}) {
  const inserts: unknown[] = [];
  const from = (table: string) => {
    let inserting = false;
    let byId: string | null = null;
    const builder: Record<string, unknown> = {};
    builder.insert = (values: unknown) => {
      inserting = true;
      inserts.push(values);
      return builder;
    };
    builder.update = () => builder;
    builder.select = () => builder;
    builder.eq = (column: string, value: string) => {
      if (column === "id") byId = value;
      return builder;
    };
    builder.maybeSingle = () =>
      Promise.resolve(
        inserting
          ? answers.insert ?? { data: null, error: null }
          : table === "orders"
            ? { data: answers.order ?? null, error: null }
            : table === "projects"
              ? { data: answers.project ?? null, error: null }
              : { data: (byId && answers.readById?.[byId]) ?? null, error: null }
      );
    // `await supabase.from("payments").select(...).eq("order_id", …)` / an update.
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: answers.orderPayments ?? [], error: null });
    return builder;
  };
  return { supabase: { from }, inserts };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "admin" } },
  });
}

const post = (route: (req: Request) => Promise<Response>, body: unknown) =>
  route(new Request("http://test/api", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  requireRouteAccess.mockReset();
  readyDeviceSaves.mockReset();
  tryAutoIssueReceiptForPayment.mockClear();
  logAuditEventAfterResponse.mockClear();
});

describe("a payment on an order, on the phone first", () => {
  it("the phone writes the row the server builds; it goes up to the order payment route with the app's id", async () => {
    const { execute } = fakeCopy({ orders: [ORDER] });
    const id = await devicePaymentSaves("orders")!.addOrderPayment(orderPayment);
    expect(id).toBeTruthy();
    const row = written(execute);
    const built = orderPaymentFrom(orderPayment, "u1");
    if ("error" in built) throw new Error(built.error);
    expect(row).toMatchObject({
      id,
      order_id: ORDER,
      amount_total: 250,
      payment_method: "check",
      payment_status: "pending", // a check waits until it's collected
      check_number: "1234",
      notes: "מקדמה",
      due_date: "2026-11-01",
      requires_split: 0,
    });
    for (const [column, value] of Object.entries(built.row)) {
      expect(row[column], column).toEqual(typeof value === "boolean" ? (value ? 1 : 0) : value);
    }

    const request = await requestForChange(queued("PUT", row), async () => null);
    expect(request).toEqual({ kind: "order-payment", url: "/api/orders/payments/create", body: { ...orderPayment, id } });
  });

  it("a refund goes in negative, as on the server", async () => {
    const { execute } = fakeCopy({ orders: [ORDER] });
    await devicePaymentSaves("sales")!.addOrderPayment({ ...orderPayment, entry_type: "refund", payment_method: "cash", due_date: undefined });
    expect(written(execute)).toMatchObject({ amount_total: -250, notes: "Refund: מקדמה" });
  });

  it("an order the phone doesn't have: null — saved on the server; an invalid one: refused with its reason", async () => {
    const { execute } = fakeCopy();
    const saves = devicePaymentSaves("orders")!;
    expect(await saves.addOrderPayment(orderPayment)).toBeNull();
    await expect(saves.addOrderPayment({ ...orderPayment, due_date: "" })).rejects.toThrow("יש להזין תאריך פירעון לצ'ק");
    expect(execute).not.toHaveBeenCalled();
  });

  it("not for people whose pages come from the server", () => {
    readyDeviceSaves.mockReturnValue(null);
    expect(devicePaymentSaves("orders")).toBeNull();
  });

  it("the route keeps the app's id", async () => {
    const { supabase, inserts } = routeClient({
      order: { id: ORDER, total_amount: 1000 },
      insert: { data: { id: PAY }, error: null },
      orderPayments: [{ amount_total: 250, payment_status: "cleared", due_date: null }],
    });
    grant(supabase);
    const res = await post(createOrderPayment, { ...orderPayment, payment_method: "cash", id: PAY });
    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({ id: PAY, order_id: ORDER, amount_total: 250, recorded_by: "auth-1" });
    expect(await res.json()).toMatchObject({ payment_status: "partial", total_paid: 250 });
    expect(tryAutoIssueReceiptForPayment).toHaveBeenCalledTimes(1);
  });

  it("the same payment again (its first answer lost): answered with it — no second receipt", async () => {
    const { supabase } = routeClient({
      order: { id: ORDER, total_amount: 250 },
      insert: { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"payments_pkey\"" } },
      readById: { [PAY]: { id: PAY, amount_total: 250 } },
      orderPayments: [{ amount_total: 250, payment_status: "cleared", due_date: null }],
    });
    grant(supabase);
    const res = await post(createOrderPayment, { ...orderPayment, payment_method: "cash", id: PAY });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ payment: { id: PAY }, payment_status: "paid", total_paid: 250 });
    expect(tryAutoIssueReceiptForPayment).not.toHaveBeenCalled();
  });

  it("without an id (the server path): as before — the database picks it", async () => {
    const { supabase, inserts } = routeClient({ order: { id: ORDER, total_amount: 1000 }, insert: { data: { id: "db" }, error: null } });
    grant(supabase);
    await post(createOrderPayment, { ...orderPayment, payment_method: "cash" });
    expect(inserts[0]).not.toHaveProperty("id");
  });
});

describe("income on a project, on the phone first", () => {
  const income = {
    project_id: PROJECT,
    amount_total: 1180,
    payment_date: "2026-10-08",
    payment_method: "bank_transfer",
    requires_split: true,
    notes: " ",
  };

  it("its domain from the project's type, VAT as the copy knows it; up to the payments route with the app's id", async () => {
    const { execute } = fakeCopy({ projects: { [PROJECT]: { project_type: "moving" } }, vat: "0.18" });
    const saved = await devicePaymentSaves("projectPage")!.addProjectPayment(income);
    expect(saved).toMatchObject({
      project_id: PROJECT,
      business_domain: "logistics_projects",
      amount_total: 1180,
      amount_before_vat: 1000,
      vat_amount: 180,
      vat_rate: 0.18,
      payment_status: "cleared",
      notes: "",
    });
    const row = written(execute);
    expect(row.id).toBe(saved!.id);
    expect(await requestForChange(queued("PUT", row), async () => null)).toEqual({
      kind: "project-payment",
      url: "/api/payments/create",
      body: { ...income, id: saved!.id },
    });
  });

  it("a project the phone doesn't have: null — saved on the server", async () => {
    fakeCopy();
    expect(await devicePaymentSaves("projectPage")!.addProjectPayment(income)).toBeNull();
  });

  it("the route keeps the app's id; a repeat is answered with the payment it already made", async () => {
    const first = routeClient({ project: { id: PROJECT, project_type: "moving" }, insert: { data: { id: PAY }, error: null } });
    grant(first.supabase);
    expect((await post(createPayment, { ...income, id: PAY })).status).toBe(200);
    expect(first.inserts[0]).toMatchObject({ id: PAY, project_id: PROJECT, business_domain: "logistics_projects", amount_before_vat: 1000 });
    expect(logAuditEventAfterResponse).toHaveBeenCalledTimes(1);
    expect(tryAutoIssueReceiptForPayment).toHaveBeenCalledTimes(1);

    const again = routeClient({
      project: { id: PROJECT, project_type: "moving" },
      insert: { data: null, error: { code: "23505", message: "duplicate key" } },
      readById: { [PAY]: { id: PAY } },
    });
    grant(again.supabase);
    const res = await post(createPayment, { ...income, id: PAY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ payment: { id: PAY } });
    expect(logAuditEventAfterResponse).toHaveBeenCalledTimes(1);
    expect(tryAutoIssueReceiptForPayment).toHaveBeenCalledTimes(1);
  });

  it("the route refuses what it refused before", async () => {
    grant(routeClient({}).supabase);
    expect((await post(createPayment, { ...income, amount_total: 0 })).status).toBe(400);
    expect((await post(createPayment, { ...income, payment_method: "check" })).status).toBe(400);
    expect((await post(createPayment, { ...income, order_id: ORDER })).status).toBe(400);
  });
});

describe("a payment marked collected, on the phone first", () => {
  it("cleared on the phone (as the database marks it), and up to the mark-collected route", async () => {
    const { execute } = fakeCopy({ payments: [PAY] });
    expect(await devicePaymentSaves("orders")!.markCollected(PAY, true)).toBe(true);
    const row = written(execute);
    expect(row).toMatchObject({ id: PAY, payment_status: "cleared" });
    expect(typeof row.cleared_at).toBe("string");
    expect(await requestForChange(queued("PATCH", row), async () => null)).toEqual({
      kind: "payment-collected",
      url: "/api/payments/mark-collected",
      body: { id: PAY, collected: true },
    });
  });

  it("back to waiting; and a payment the phone doesn't have: false — on the server", async () => {
    const { execute } = fakeCopy({ payments: [PAY] });
    const saves = devicePaymentSaves("orders")!;
    await saves.markCollected(PAY, false);
    expect(written(execute)).toMatchObject({ payment_status: "pending", cleared_at: null });
    expect(await saves.markCollected("other", true)).toBe(false);
  });
});

describe("which payment changes go up on their own", () => {
  it("one made by itself carries its request; an order's own payments go with the order", () => {
    expect(isCarriedChange({ table: "payments", opData: { _extras: "{}" } } as never)).toBe(false);
    expect(isCarriedChange({ table: "payments", opData: { amount_total: 60 } } as never)).toBe(true);
    expect(isCarriedChange({ table: "payments" } as never)).toBe(true);
    expect(isCarriedChange({ table: "order_items" } as never)).toBe(true);
    expect(isCarriedChange({ table: "inventory" } as never)).toBe(true);
    expect(isCarriedChange({ table: "orders", opData: {} } as never)).toBe(false);
  });
});
