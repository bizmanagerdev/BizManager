import { describe, expect, it } from "vitest";
import { findInvalidOrderItem, normalizeOrderItems, orderTotals } from "@/lib/orders/order-input";

// The server's own reading of an order's lines — what create, update and the
// phone's saves all go through.
describe("normalizeOrderItems — a line's discount", () => {
  it("never exceeds the line, so neither the line nor the order goes below zero", () => {
    const items = normalizeOrderItems([{ product_id: "p1", quantity_ordered: 1, unit_price: 120, discount_amount: 200 }]);
    expect(items[0].discount_amount).toBe(120);
    expect(orderTotals(items, 0)).toEqual({ subtotal: 0, totalAmount: 0 });
  });

  it("keeps a discount that fits the line as it is", () => {
    const [line] = normalizeOrderItems([{ product_id: "p1", quantity_ordered: 2, unit_price: 120, discount_amount: 200 }]);
    expect(line.discount_amount).toBe(200);
  });

  it("still refuses a line whose numbers aren't numbers", () => {
    const items = normalizeOrderItems([{ product_id: "p1", quantity_ordered: "x", unit_price: 120, discount_amount: 10 }]);
    expect(findInvalidOrderItem(items)).toBeDefined();
  });
});
