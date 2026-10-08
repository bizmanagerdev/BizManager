// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// An order saved on the phone first (owner, 2026-10-07/08): the phone writes
// the order, its lines, its payments and the stock it takes in one go — so
// its own unsent orders count as reserved — and only the order's change goes
// up, through the same create / update routes, carrying everything; the
// create route keeps the app's order and payment ids, and answers a repeat
// with the order it already made. A refused new order comes back as its draft.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));
vi.mock("@/lib/morning/service", () => ({ tryAutoIssueInvoiceForOrder: vi.fn(), tryAutoIssueReceiptForPayment: vi.fn() }));
const { notifyNewEntity } = vi.hoisted(() => ({ notifyNewEntity: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/new-entity", () => ({ notifyNewEntity }));
vi.mock("@/lib/after-response", () => ({ runAfterResponse: (_label: string, run: () => unknown) => run() }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: {} }) }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

import { POST as createOrder } from "@/app/api/orders/create/route";
import { createOrderOnDevice, updateOrderOnDevice } from "@/lib/orders/device-order-writes";
import { resolveDelivered, normalizeOrderItems } from "@/lib/orders/order-input";
import { isCarriedChange, requestForChange, restoreForChange, DEVICE_SAVE_REFUSED_EVENT } from "@/lib/powersync/local-writes";
import { BizConnector } from "@/lib/powersync/connector";

const ORDER = "11111111-2222-4333-8444-555555555555";
const PAY = "66666666-7777-4888-9999-aaaaaaaaaaaa";

const body = {
  customer_id: "c1",
  branch_id: null,
  order_date: "2026-10-08",
  status: "draft",
  payment_terms: "eom",
  due_date: null,
  discount_amount: 10,
  needs_invoice: true,
  collect_payment_on_delivery: false,
  notes: " ",
  items: [
    { product_id: "bags", description: "", quantity_ordered: 5, unit_price: 20, discount_amount: 0, notes: null },
    { product_id: "", description: "הובלה", quantity_ordered: 1, unit_price: 50, discount_amount: 0, notes: "ערב" },
  ],
  payments: [{ id: PAY, amount_total: 60, payment_date: "2026-10-08", payment_method: "cash", account_id: "acc", due_date: null, reference_number: null, check_number: null, notes: null }],
};

type Call = [string, unknown[]?];

/** A fake device copy: what the transaction reads, and every write it makes. */
function fakeCopy(reads: { order?: { status: string } | null; lines?: unknown[]; payments?: unknown[] } = {}) {
  const calls: Call[] = [];
  const tx = {
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push([sql.replace(/\s+/g, " ").trim(), params]);
      return {};
    }),
    getOptional: vi.fn(async () => reads.order ?? null),
    getAll: vi.fn(async (sql: string) => (sql.includes("FROM order_items") ? reads.lines ?? [] : reads.payments ?? [])),
  };
  const db = { writeTransaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { db, calls };
}

const rowOf = (call: Call) => {
  const [sql, params = []] = call;
  const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((c) => c.trim());
  return Object.fromEntries(columns.map((c, i) => [c, params[i]]));
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  notifyNewEntity.mockClear();
});

describe("an order saved on the phone first", () => {
  it("writes the order, its lines, its payment and the stock it takes — in one transaction", async () => {
    const { db, calls } = fakeCopy();
    await createOrderOnDevice(db as never, { id: ORDER, body, createdBy: "u1", restore: { key: "order-create", draft: { step: "summary" } } });
    expect(db.writeTransaction).toHaveBeenCalledTimes(1);

    const order = rowOf(calls.find(([sql]) => sql.startsWith("INSERT INTO orders"))!);
    expect(order).toMatchObject({
      id: ORDER,
      status: "draft",
      subtotal: 150, // 5×20 + 50
      discount_amount: 10,
      total_amount: 140,
      payment_status: "partial", // 60 of 140 in cash
      notes: null,
      payment_terms: "eom",
      due_date: "2026-10-31",
      needs_invoice: 1,
    });
    const extras = JSON.parse(String(order._extras));
    expect(extras.body).toMatchObject({ id: ORDER, payments: [expect.objectContaining({ id: PAY })] });
    expect(extras.restore).toEqual({ key: "order-create", draft: { step: "summary" } });

    const lines = calls.filter(([sql]) => sql.startsWith("INSERT INTO order_items")).map(rowOf);
    expect(lines).toEqual([
      expect.objectContaining({ order_id: ORDER, product_id: "bags", description: null, quantity_ordered: 5, quantity_delivered: 0, line_total: 100 }),
      expect.objectContaining({ order_id: ORDER, product_id: null, description: "הובלה", line_total: 50, notes: "ערב" }),
    ]);
    const payment = rowOf(calls.find(([sql]) => sql.startsWith("INSERT INTO payments"))!);
    expect(payment).toMatchObject({ id: PAY, order_id: ORDER, amount_total: 60, payment_status: "cleared", business_domain: "sales" });

    // Stock: the 5 bags reserved on this phone (the custom line takes none).
    const stock = calls.filter(([sql]) => sql.startsWith("UPDATE inventory"));
    expect(stock).toEqual([[expect.stringContaining("quantity_reserved"), [5, 0, "bags"]]]);
  });

  it("only the order's change goes up — carrying the lines and payments; the rest travels with it", async () => {
    const { db, calls } = fakeCopy();
    await createOrderOnDevice(db as never, { id: ORDER, body, createdBy: "u1", restore: { key: "order-create", draft: { step: "summary" } } });
    const order = rowOf(calls.find(([sql]) => sql.startsWith("INSERT INTO orders"))!);
    const op = { table: "orders", op: "PUT", id: ORDER, opData: order };
    const request = await requestForChange(op as never, async () => null);
    expect(request).toMatchObject({ kind: "order-create", url: "/api/orders/create" });
    expect(request?.body).toMatchObject({ id: ORDER, customer_id: "c1", items: body.items, payments: [expect.objectContaining({ id: PAY })] });
    expect(request?.body).not.toHaveProperty("restore");
    expect(restoreForChange(op as never)).toEqual({ key: "order-create", draft: { step: "summary" } });
    expect(isCarriedChange({ table: "order_items" })).toBe(true);
    expect(isCarriedChange({ table: "payments" })).toBe(true);
    expect(isCarriedChange({ table: "inventory" })).toBe(true);
    expect(isCarriedChange({ table: "orders" })).toBe(false);
  });

  it("an edit: lines replaced keeping what was delivered, new payments, stock moved by the difference", async () => {
    const { db, calls } = fakeCopy({
      order: { status: "partially_delivered" },
      lines: [{ product_id: "bags", quantity_ordered: "5", quantity_delivered: "2" }],
      payments: [{ amount_total: "60", net_amount: "60", payment_status: "cleared", due_date: null }],
    });
    const edited = {
      ...body,
      status: "partially_delivered",
      items: [{ product_id: "bags", quantity_ordered: 8, unit_price: 20, discount_amount: 0 }],
      payments: [{ amount_total: 40, payment_date: "2026-10-08", payment_method: "bit", account_id: "acc" }],
      existing_payment_notes: [{ id: PAY, notes: "שולם במקום" }],
    };
    expect(await updateOrderOnDevice(db as never, { id: ORDER, body: edited, updatedBy: "u1" })).toBe(true);

    const update = calls.find(([sql]) => sql.startsWith("UPDATE orders"))!;
    expect(update[1]).toEqual(expect.arrayContaining(["partially_delivered", 160, 150, "partial"])); // 8×20 − 10; 60+40 of 150
    expect(JSON.parse(String((update[1] as unknown[]).at(-2))).body).toMatchObject({ order_id: ORDER });
    expect(calls.some(([sql]) => sql === "DELETE FROM order_items WHERE order_id = ?")).toBe(true);
    const line = rowOf(calls.find(([sql]) => sql.startsWith("INSERT INTO order_items"))!);
    expect(line).toMatchObject({ quantity_ordered: 8, quantity_delivered: 2 }); // the 2 already delivered stay
    expect(calls.some(([sql, p]) => sql.startsWith("UPDATE payments SET notes") && p?.[0] === "שולם במקום")).toBe(true);
    // Reserved 3 before (5−2), 6 now (8−2): 3 more on this phone; nothing more out.
    expect(calls.find(([sql]) => sql.startsWith("UPDATE inventory"))?.[1]).toEqual([3, 0, "bags"]);
  });

  it("an edit of an order the phone doesn't have: false — saved on the server instead", async () => {
    const { db, calls } = fakeCopy({ order: null });
    expect(await updateOrderOnDevice(db as never, { id: ORDER, body, updatedBy: "u1" })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("delivered amounts and status as the database works them out", () => {
    const items = normalizeOrderItems([{ product_id: "a", quantity_ordered: 3, unit_price: 1 }, { product_id: "b", quantity_ordered: 2, unit_price: 1, quantity_delivered: 1 }]);
    expect(resolveDelivered(items, "delivered").status).toBe("partially_delivered"); // b is short
    expect(resolveDelivered(items, "cancelled").lines.map((l) => l.quantity_delivered)).toEqual([0, 0]);
    expect(resolveDelivered(items, "Draft").lines.map((l) => l.quantity_delivered)).toEqual([0, 1]);
  });

  it("the connector sends the order once, skips what travels with it, and hands back a refused order's form", async () => {
    const { db, calls } = fakeCopy();
    await createOrderOnDevice(db as never, { id: ORDER, body, createdBy: "u1", restore: { key: "quick-create-order", draft: { step: "summary" } } });
    const order = rowOf(calls.find(([sql]) => sql.startsWith("INSERT INTO orders"))!);
    const ops = [
      { clientId: 1, table: "orders", op: "PUT", id: ORDER, opData: order },
      { clientId: 2, table: "order_items", op: "PUT", id: "l1", opData: {} },
      { clientId: 3, table: "payments", op: "PUT", id: PAY, opData: {} },
      { clientId: 4, table: "inventory", op: "PATCH", id: "bags", opData: {} },
    ];
    const transaction = { crud: ops, complete: vi.fn(async () => {}) };
    const database = { getNextCrudTransaction: vi.fn(async () => transaction), getOptional: vi.fn() };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "אין מספיק מלאי" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const refused: unknown[] = [];
    const listen = (e: Event) => refused.push((e as CustomEvent).detail);
    window.addEventListener(DEVICE_SAVE_REFUSED_EVENT, listen);
    await new BizConnector().uploadData(database as never);
    window.removeEventListener(DEVICE_SAVE_REFUSED_EVENT, listen);
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/orders/create");
    expect(transaction.complete).toHaveBeenCalled();
    expect(refused).toEqual([
      { kind: "order-create", message: "אין מספיק מלאי", restore: { key: "quick-create-order", draft: { step: "summary" } } },
    ]);
  });
});

describe("the create route with the app's ids", () => {
  type Resp = { data: unknown; error: unknown };
  function makeSupabase(rpc: Resp, answer: (table: string, method: string) => Resp) {
    const calls: { table: string; method: string; args: unknown[] }[] = [];
    const from = (table: string) => {
      let last = "";
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          if (method !== "eq" && method !== "select") last = method;
          if (method === "select" && !last) last = "select";
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(answer(table, last));
      builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(answer(table, last)).then(onF, onR);
      return builder;
    };
    const rpcFn = vi.fn(async () => rpc);
    return { supabase: { from, rpc: rpcFn }, calls, rpcFn };
  }
  const grant = (supabase: unknown) =>
    requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "admin" } } });
  const post = (payload: unknown) => createOrder(new Request("http://test/api/orders/create", { method: "POST", body: JSON.stringify(payload) }));

  it("keeps the order's id (p_order_id) and the payments' ids", async () => {
    const { supabase, calls, rpcFn } = makeSupabase({ data: ORDER, error: null }, (table) =>
      table === "payments" ? { data: [{ id: PAY }], error: null } : { data: null, error: null }
    );
    grant(supabase);
    const res = await post({ ...body, id: ORDER });
    expect(res.status).toBe(200);
    expect(rpcFn).toHaveBeenCalledWith("create_sales_order", expect.objectContaining({ p_order_id: ORDER, p_total_amount: 140, p_subtotal: 150 }));
    expect(calls.find((c) => c.table === "payments" && c.method === "insert")?.args[0]).toEqual([
      expect.objectContaining({ id: PAY, order_id: ORDER, amount_total: 60 }),
    ]);
    expect(notifyNewEntity).toHaveBeenCalledTimes(1);
  });

  it("the same order again (its first answer lost): answered with it — no second order, no second alert", async () => {
    const { supabase } = makeSupabase({ data: null, error: { code: "23505", message: "duplicate key" } }, (table) =>
      table === "orders" ? { data: { id: ORDER, payment_status: "partial" }, error: null } : { data: [{ id: PAY, amount_total: 60, payment_status: "cleared" }], error: null }
    );
    grant(supabase);
    const res = await post({ ...body, id: ORDER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ order_id: ORDER, payment_status: "partial", total_paid: 60, payment_ids: [PAY] });
    expect(notifyNewEntity).not.toHaveBeenCalled();
  });

  it("without an id (the server path): as before — no p_order_id", async () => {
    const { supabase, rpcFn } = makeSupabase({ data: "db-made", error: null }, () => ({ data: [], error: null }));
    grant(supabase);
    const res = await post({ ...body, payments: [] });
    expect(res.status).toBe(200);
    expect(rpcFn.mock.calls[0]).toBeDefined();
    expect((rpcFn.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).not.toHaveProperty("p_order_id");
  });
});
