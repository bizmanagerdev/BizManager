import { describe, it, expect } from "vitest";
import { buildProductMarginByMonth } from "@/lib/financial/productMargin";
import type {
  MarginOrderInput,
  MarginItemInput,
  MarginProductInput,
} from "@/lib/financial/productMargin";

// Product sales / gross margin per month: revenue = Σ line_total (by order_date),
// cost = Σ quantity × product.base_cost, profit = revenue − cost. Everything is
// line-based so per-product / per-order / per-month reconcile.

function build(
  parts: {
    orders?: MarginOrderInput[];
    items?: MarginItemInput[];
    products?: MarginProductInput[];
  },
  options: { from?: string | null; to?: string | null } = {}
) {
  return buildProductMarginByMonth(parts.orders ?? [], parts.items ?? [], parts.products ?? [], options);
}

const PRODUCTS: MarginProductInput[] = [
  { id: "p1", name: "מוצר א", baseCost: 10 },
  { id: "p2", name: "מוצר ב", baseCost: 25 },
  { id: "p3", name: "מוצר ג", baseCost: null }, // no cost recorded
];

describe("buildProductMarginByMonth", () => {
  it("computes revenue − COGS per month", () => {
    const report = build({
      orders: [{ orderId: "o1", orderDate: "2026-03-05", status: "closed", customer: "קוזי בייבי" }],
      items: [
        { orderId: "o1", productId: "p1", quantity: 2, lineTotal: 100 }, // cost 20
        { orderId: "o1", productId: "p2", quantity: 4, lineTotal: 200 }, // cost 100
      ],
      products: PRODUCTS,
    });
    expect(report.months).toHaveLength(1);
    const m = report.months[0];
    expect(m.month).toBe("2026-03");
    expect(m.orderCount).toBe(1);
    expect(m.unitsSold).toBe(6);
    expect(m.revenue).toBe(300);
    expect(m.cost).toBe(120);
    expect(m.profit).toBe(180);
    expect(report.totals.profit).toBe(180);
  });

  it("breaks each month down per product (sorted by revenue), with units + profit", () => {
    const report = build({
      orders: [
        { orderId: "o1", orderDate: "2026-03-05", status: "closed" },
        { orderId: "o2", orderDate: "2026-03-09", status: "closed" },
      ],
      items: [
        { orderId: "o1", productId: "p1", quantity: 2, lineTotal: 100 }, // cost 20
        { orderId: "o2", productId: "p1", quantity: 3, lineTotal: 150 }, // cost 30
        { orderId: "o1", productId: "p2", quantity: 4, lineTotal: 200 }, // cost 100
      ],
      products: PRODUCTS,
    });
    const products = report.months[0].products;
    // p1 aggregates across both orders: 5 units, 250 revenue, 50 cost, 200 profit —
    // higher revenue than p2 (200), so it sorts first.
    expect(products[0]).toMatchObject({ productId: "p1", quantity: 5, revenue: 250, cost: 50, profit: 200 });
    expect(products[1]).toMatchObject({ productId: "p2", quantity: 4, revenue: 200, cost: 100, profit: 100 });
  });

  it("excludes cancelled orders (revenue AND their cost)", () => {
    const report = build({
      orders: [
        { orderId: "o1", orderDate: "2026-03-05", status: "closed" },
        { orderId: "o2", orderDate: "2026-03-06", status: "cancelled" },
      ],
      items: [
        { orderId: "o1", productId: "p1", quantity: 1, lineTotal: 50 }, // cost 10
        { orderId: "o2", productId: "p2", quantity: 10, lineTotal: 999 }, // ignored
      ],
      products: PRODUCTS,
    });
    expect(report.totals.orderCount).toBe(1);
    expect(report.totals.revenue).toBe(50);
    expect(report.totals.cost).toBe(10);
  });

  it("flags products with no cost and lists them", () => {
    const report = build({
      orders: [{ orderId: "o1", orderDate: "2026-04-01", status: "closed" }],
      items: [
        { orderId: "o1", productId: "p1", quantity: 1, lineTotal: 50 }, // cost 10
        { orderId: "o1", productId: "p3", quantity: 3, lineTotal: 300 }, // null cost → 0, flagged
      ],
      products: PRODUCTS,
    });
    const m = report.months[0];
    expect(m.cost).toBe(10); // only p1 contributes
    expect(m.itemsMissingCost).toBe(1);
    expect(m.products.find((p) => p.productId === "p3")?.missingCost).toBe(true);
    expect(report.productsMissingCost).toEqual([{ id: "p3", name: "מוצר ג" }]);
  });

  it("produces a per-order detail list (newest first) with customer + profit", () => {
    const report = build({
      orders: [
        { orderId: "o1", orderDate: "2026-03-05", status: "closed", customer: "קוזי בייבי" },
        { orderId: "o2", orderDate: "2026-03-20", status: "closed" }, // no customer → fallback
      ],
      items: [
        { orderId: "o1", productId: "p1", quantity: 2, lineTotal: 300 }, // cost 20
        { orderId: "o2", productId: "p3", quantity: 1, lineTotal: 100 }, // null cost → 0, flagged
      ],
      products: PRODUCTS,
    });
    expect(report.orders.map((o) => o.orderId)).toEqual(["o2", "o1"]); // newest first
    expect(report.orders[1]).toMatchObject({
      customer: "קוזי בייבי",
      revenue: 300,
      cost: 20,
      profit: 280,
      missingCost: false,
    });
    expect(report.orders[0]).toMatchObject({ customer: "הזמנה", cost: 0, profit: 100, missingCost: true });
  });

  it("lists the products bought within each order", () => {
    const report = build({
      orders: [{ orderId: "o1", orderDate: "2026-03-05", status: "closed" }],
      items: [
        { orderId: "o1", productId: "p1", quantity: 2, lineTotal: 100 }, // cost 20
        { orderId: "o1", productId: "p2", quantity: 5, lineTotal: 400 }, // cost 125 → sorts first
        { orderId: "o1", productId: "p1", quantity: 1, lineTotal: 50 }, // merges into p1
      ],
      products: PRODUCTS,
    });
    const items = report.orders[0].items;
    expect(items[0]).toMatchObject({ productId: "p2", quantity: 5, revenue: 400 }); // higher revenue first
    expect(items[1]).toMatchObject({ productId: "p1", quantity: 3, revenue: 150, cost: 30 }); // merged
  });

  it("trims returned months to the from/to window", () => {
    const report = build(
      {
        orders: [
          { orderId: "o1", orderDate: "2026-01-10", status: "closed" },
          { orderId: "o2", orderDate: "2026-05-10", status: "closed" },
        ],
        items: [
          { orderId: "o1", productId: "p1", quantity: 1, lineTotal: 50 },
          { orderId: "o2", productId: "p1", quantity: 1, lineTotal: 50 },
        ],
        products: PRODUCTS,
      },
      { from: "2026-03-01", to: "2026-06-30" }
    );
    expect(report.months.map((m) => m.month)).toEqual(["2026-05"]);
  });

  it("skips orders with no order_date", () => {
    const report = build({
      orders: [{ orderId: "o1", orderDate: null, status: "closed" }],
      items: [{ orderId: "o1", productId: "p1", quantity: 5, lineTotal: 250 }],
      products: PRODUCTS,
    });
    expect(report.months).toHaveLength(0);
    expect(report.totals.revenue).toBe(0);
    expect(report.totals.cost).toBe(0);
  });
});
