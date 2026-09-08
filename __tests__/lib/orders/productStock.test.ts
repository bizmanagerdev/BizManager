import { describe, it, expect } from "vitest";
import { attachProductStock } from "@/lib/orders/productStock";

function makeSupabase(inventoryRows: Array<Record<string, unknown>>) {
  const from = () => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.in = () => Promise.resolve({ data: inventoryRows, error: null });
    return builder;
  };
  return { from } as unknown as Parameters<typeof attachProductStock>[0];
}

describe("attachProductStock", () => {
  it("computes available_quantity as on_hand minus reserved", () => {
    const supabase = makeSupabase([{ product_id: "p1", quantity_on_hand: 10, quantity_reserved: 3 }]);
    return attachProductStock(supabase, [{ id: "p1", name: "מוצר" }]).then((rows) => {
      expect(rows[0].available_quantity).toBe(7);
    });
  });

  it("a product with no inventory row gets null (unknown), not 0 — no false low-stock warning", () => {
    const supabase = makeSupabase([]);
    return attachProductStock(supabase, [{ id: "p1", name: "מוצר" }]).then((rows) => {
      expect(rows[0].available_quantity).toBeNull();
    });
  });

  it("treats a missing reserved figure as 0", () => {
    const supabase = makeSupabase([{ product_id: "p1", quantity_on_hand: 5 }]);
    return attachProductStock(supabase, [{ id: "p1" }]).then((rows) => {
      expect(rows[0].available_quantity).toBe(5);
    });
  });

  it("returns the rows unchanged (no query) when given an empty list", async () => {
    const supabase = makeSupabase([]);
    const rows = await attachProductStock(supabase, []);
    expect(rows).toEqual([]);
  });

  it("preserves every other field on the row", async () => {
    const supabase = makeSupabase([{ product_id: "p1", quantity_on_hand: 10, quantity_reserved: 2 }]);
    const rows = await attachProductStock(supabase, [{ id: "p1", name: "מוצר", price: 50 }]);
    expect(rows[0]).toMatchObject({ id: "p1", name: "מוצר", price: 50, available_quantity: 8 });
  });
});
