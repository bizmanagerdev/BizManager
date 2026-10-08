import { describe, expect, it } from "vitest";
import { createLocalSupabase, type LocalReader } from "@/lib/powersync/local-supabase";
import { AppSchema } from "@/lib/powersync/schema";
import { loadOrderEditData } from "@/lib/orders/order-edit-data";

// What the order form loads to edit an order — one loader for the edit
// dialog, the edit page and the phone's copy (owner, 2026-10-08: the edit
// page used to read less, and saving there reset the order's terms, due date,
// invoice and collect-on-delivery, and failed on custom lines). Run here on
// the phone's copy, as the edit dialog does with no signal.

type Row = Record<string, unknown>;

const COLUMNS = new Map(AppSchema.tables.map((table) => [table.name, table.columns.map((column) => column.name)]));
const padded = (table: string, row: Row): Row => ({
  ...Object.fromEntries((COLUMNS.get(table) ?? []).map((column) => [column, null])),
  ...row,
});

/** A fake device database: rows as PowerSync stores them (1/0, numeric text). */
function fakeReader(tables: Record<string, Row[]>): LocalReader {
  return {
    async getAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const match = /^SELECT \* FROM ([a-z_]+)(?: WHERE (.*))?$/.exec(sql);
      if (!match) throw new Error(`fake reader can't run: ${sql}`);
      let rows = (tables[match[1]] ?? []).map((row) => padded(match[1], row));
      if (match[2]) {
        let p = 0;
        for (const clause of match[2].split(" AND ")) {
          const eq = /^([a-z_]+) = \?$/.exec(clause);
          const inList = /^([a-z_]+) IN \(([?,]+)\)$/.exec(clause);
          if (eq) {
            const value = params[p++];
            rows = rows.filter((r) => r[eq[1]] === value);
          } else if (inList) {
            const n = inList[2].split(",").length;
            const values = params.slice(p, p + n);
            p += n;
            rows = rows.filter((r) => values.includes(r[inList[1]]));
          } else {
            throw new Error(`fake reader can't filter: ${clause}`);
          }
        }
      }
      return rows.map((r) => ({ ...r })) as T[];
    },
  };
}

const copy = (): Record<string, Row[]> => ({
  orders: [
    {
      id: "o1",
      customer_id: "c1",
      branch_id: null,
      order_date: "2026-10-08",
      status: "open",
      payment_status: "partial",
      payment_terms: "eom_30",
      due_date: "2026-11-30",
      discount_amount: "10",
      needs_invoice: 1,
      collect_payment_on_delivery: 1,
      notes: "דחוף",
      requested_delivery_date: "2026-10-12",
    },
  ],
  order_items: [
    { id: "l1", order_id: "o1", product_id: "p1", description: null, quantity_ordered: "5", quantity_delivered: "2", unit_price: "20", discount_amount: "0", notes: null },
    { id: "l2", order_id: "o1", product_id: null, description: "הובלה", quantity_ordered: "1", quantity_delivered: "0", unit_price: "50", discount_amount: "0", notes: "ערב" },
  ],
  payments: [
    { id: "pay1", order_id: "o1", payment_date: "2026-10-08", amount_total: "60", payment_method: "cash", reference_number: null, notes: null },
  ],
  customers: [{ id: "c1", name: "לקוח", phone: "0500000000", requires_prepayment: 0 }],
  products: [{ id: "p1", name: "שקיות", sku: "bags", base_price: "20", active: 1 }],
  inventory: [{ id: "p1", product_id: "p1", quantity_on_hand: "100", quantity_reserved: "30" }],
});

describe("the order edit form's load", () => {
  it("on the phone's copy: the order's own terms, due date, invoice and collect-on-delivery, custom lines by name", async () => {
    const result = await loadOrderEditData(createLocalSupabase(fakeReader(copy())), "o1", { deliveryImages: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.initialOrder).toMatchObject({
      id: "o1",
      customer_id: "c1",
      status: "open",
      payment_terms: "eom_30",
      due_date: "2026-11-30",
      needs_invoice: true,
      collect_payment_on_delivery: true,
      discount_amount: 10,
      notes: "דחוף",
      requested_delivery_date: "2026-10-12",
    });
    expect(result.data.initialOrder.items).toEqual([
      expect.objectContaining({ product_id: "p1", product_name: "שקיות", quantity_ordered: 5, quantity_delivered: 2, available_quantity: 70 }),
      expect.objectContaining({ product_id: "", description: "הובלה", product_name: "הובלה", quantity_ordered: 1, notes: "ערב" }),
    ]);
    expect(result.data.initialPayments).toEqual([
      { id: "pay1", payment_date: "2026-10-08", amount_total: 60, payment_method: "cash", reference_number: "", notes: "" },
    ]);
    expect(result.data.customers.map((c) => c.id)).toEqual(["c1"]);
    expect(result.data.products).toEqual([expect.objectContaining({ id: "p1", available_quantity: 70 })]);
    expect(result.data.deliveryImages).toEqual([]);
  });

  it("an order the copy doesn't have: not found (the dialog then reads it from the server)", async () => {
    const result = await loadOrderEditData(createLocalSupabase(fakeReader(copy())), "missing", { deliveryImages: false });
    expect(result).toEqual({ ok: false, status: 404, error: "Order not found" });
  });

  it("the delivery confirmation's load: the order's own lines and their stock, no lists", async () => {
    const result = await loadOrderEditData(createLocalSupabase(fakeReader(copy())), "o1", { confirm: true, deliveryImages: false });
    expect(result.ok && result.data.customers).toEqual([]);
    expect(result.ok && result.data.products.map((p) => p.id)).toEqual(["p1"]);
  });
});
