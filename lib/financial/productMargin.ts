import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";

// ════════════════════════════════════════════════════════════════════════════
// Product sales & gross margin — how much of each product we sold and what we
// ACTUALLY made on it, per month.
//
//   מכירות (revenue) = Σ order-line line_total, in the order's order_date month.
//     Line-based so per-product / per-order / per-month all reconcile.
//   עלות (COGS)       = Σ (quantity_ordered × product.base_cost). base_cost is the
//     price it COST us to buy the product; it is NOT snapshotted on the line, so
//     we look up the product's CURRENT cost.
//   רווח (profit)     = revenue − cost.
//
// base_cost is nullable — a product with no cost recorded contributes 0 cost
// (which inflates its margin), so we flag those lines/products so the user can
// fill the missing costs in. Cancelled orders are excluded entirely.
// ════════════════════════════════════════════════════════════════════════════

const EXCLUDED_ORDER_STATUSES = new Set(["cancelled", "בוטלה"]);

/** Per-product roll-up within one month: units sold + what we made on it. */
export type ProductMonthStat = {
  productId: string;
  name: string;
  quantity: number; // units sold this month
  revenue: number; // Σ line_total this month
  cost: number; // Σ quantity × base_cost
  profit: number; // revenue − cost
  missingCost: boolean; // product has no base_cost (profit inflated)
};

export type ProductMarginMonth = {
  month: string; // YYYY-MM
  orderCount: number;
  unitsSold: number; // Σ quantity across products
  revenue: number;
  cost: number;
  profit: number; // revenue − cost
  itemsMissingCost: number; // line items whose product has no base_cost
  products: ProductMonthStat[]; // sorted by revenue desc
};

/** One product bought within an order. */
export type ProductMarginOrderItem = {
  productId: string;
  name: string;
  quantity: number;
  revenue: number; // line_total
  cost: number; // quantity × base_cost
  profit: number; // revenue − cost
  missingCost: boolean; // product has no base_cost
};

/** One order in the detailed list: what we sold it for minus what it cost us. */
export type ProductMarginOrder = {
  orderId: string;
  date: string | null; // order_date
  customer: string;
  revenue: number; // Σ its line_totals
  cost: number; // Σ quantity × base_cost over its lines
  profit: number; // revenue − cost
  missingCost: boolean; // ≥1 line's product has no base_cost (profit inflated)
  items: ProductMarginOrderItem[]; // products bought, by revenue desc
};

export type ProductMarginTotals = {
  orderCount: number;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  itemsMissingCost: number;
};

export type ProductMarginReport = {
  months: ProductMarginMonth[]; // ascending by month
  /** Every included order, newest first — the line-by-line detail list. */
  orders: ProductMarginOrder[];
  totals: ProductMarginTotals;
  /** Distinct products that appear in orders but have no base_cost recorded. */
  productsMissingCost: Array<{ id: string; name: string }>;
};

export type MarginOrderInput = {
  orderId: string;
  orderDate: string | null;
  status: string | null;
  customer?: string | null;
};
export type MarginItemInput = {
  orderId: string;
  productId: string;
  quantity: number;
  lineTotal: number;
};
export type MarginProductInput = {
  id: string;
  name: string;
  baseCost: number | null;
};

type Row = Record<string, unknown>;

function toNum(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown) {
  return typeof value === "string" ? value : null;
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

/**
 * Build the per-month product sales / margin report. `from`/`to` (YYYY-MM-DD or
 * YYYY-MM) trim which months are RETURNED.
 */
export function buildProductMarginByMonth(
  orders: MarginOrderInput[],
  items: MarginItemInput[],
  products: MarginProductInput[],
  options: { from?: string | null; to?: string | null } = {}
): ProductMarginReport {
  const fromMonth = options.from ? options.from.slice(0, 7) : null;
  const toMonth = options.to ? options.to.slice(0, 7) : null;
  const inWindow = (month: string) =>
    (!fromMonth || month >= fromMonth) && (!toMonth || month <= toMonth);

  const productById = new Map<string, MarginProductInput>();
  for (const p of products) productById.set(p.id, p);

  // Per-order accumulator (date/customer/month + its running revenue & cost),
  // skipping cancelled/undated orders so their lines are ignored too.
  type ItemAcc = { name: string; quantity: number; revenue: number; cost: number; missingCost: boolean };
  type OrderAcc = {
    orderId: string;
    month: string;
    date: string | null;
    customer: string;
    revenue: number;
    cost: number;
    itemsMissingCost: number;
    items: Map<string, ItemAcc>; // productId -> line roll-up
  };
  const orderAcc = new Map<string, OrderAcc>();
  for (const order of orders) {
    if (EXCLUDED_ORDER_STATUSES.has((order.status ?? "").trim().toLowerCase())) continue;
    if (!order.orderDate) continue;
    orderAcc.set(order.orderId, {
      orderId: order.orderId,
      month: monthKey(order.orderDate),
      date: order.orderDate,
      customer: order.customer?.trim() || "הזמנה",
      revenue: 0,
      cost: 0,
      itemsMissingCost: 0,
      items: new Map(),
    });
  }

  // month -> productId -> per-product stat.
  type StatAcc = { name: string; quantity: number; revenue: number; cost: number; missingCost: boolean };
  const monthProducts = new Map<string, Map<string, StatAcc>>();
  const missingProducts = new Map<string, string>();

  for (const item of items) {
    const oa = orderAcc.get(item.orderId);
    if (!oa) continue; // cancelled / undated / unknown order
    const product = productById.get(item.productId);
    const hasCost = !!product && product.baseCost != null;
    const lineRevenue = item.lineTotal;
    const lineCost = hasCost ? item.quantity * (product!.baseCost as number) : 0;

    oa.revenue += lineRevenue;
    oa.cost += lineCost;
    if (!hasCost) {
      oa.itemsMissingCost += 1;
      if (product) missingProducts.set(product.id, product.name);
    }

    // Per-product roll-up within this order (merge repeated product lines).
    let orderItem = oa.items.get(item.productId);
    if (!orderItem) {
      orderItem = { name: product?.name ?? "מוצר", quantity: 0, revenue: 0, cost: 0, missingCost: false };
      oa.items.set(item.productId, orderItem);
    }
    orderItem.quantity += item.quantity;
    orderItem.revenue += lineRevenue;
    orderItem.cost += lineCost;
    if (!hasCost) orderItem.missingCost = true;

    let byProduct = monthProducts.get(oa.month);
    if (!byProduct) {
      byProduct = new Map();
      monthProducts.set(oa.month, byProduct);
    }
    let stat = byProduct.get(item.productId);
    if (!stat) {
      stat = { name: product?.name ?? "מוצר", quantity: 0, revenue: 0, cost: 0, missingCost: false };
      byProduct.set(item.productId, stat);
    }
    stat.quantity += item.quantity;
    stat.revenue += lineRevenue;
    stat.cost += lineCost;
    if (!hasCost) stat.missingCost = true;
  }

  // Per-order detail list, newest first.
  const orderList: ProductMarginOrder[] = Array.from(orderAcc.values())
    .filter((o) => inWindow(o.month))
    .map((o) => ({
      orderId: o.orderId,
      date: o.date,
      customer: o.customer,
      revenue: o.revenue,
      cost: o.cost,
      profit: o.revenue - o.cost,
      missingCost: o.itemsMissingCost > 0,
      items: Array.from(o.items.entries())
        .map(([productId, it]) => ({
          productId,
          name: it.name,
          quantity: it.quantity,
          revenue: it.revenue,
          cost: it.cost,
          profit: it.revenue - it.cost,
          missingCost: it.missingCost,
        }))
        .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity),
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // Per-month order counts.
  const orderCountByMonth = new Map<string, number>();
  for (const o of orderAcc.values()) {
    orderCountByMonth.set(o.month, (orderCountByMonth.get(o.month) ?? 0) + 1);
  }

  const allMonths = new Set<string>([...monthProducts.keys(), ...orderCountByMonth.keys()]);
  const months: ProductMarginMonth[] = Array.from(allMonths)
    .filter(inWindow)
    .sort()
    .map((month) => {
      const byProduct = monthProducts.get(month) ?? new Map<string, StatAcc>();
      const productList: ProductMonthStat[] = Array.from(byProduct.entries())
        .map(([productId, s]) => ({
          productId,
          name: s.name,
          quantity: s.quantity,
          revenue: s.revenue,
          cost: s.cost,
          profit: s.revenue - s.cost,
          missingCost: s.missingCost,
        }))
        .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity);

      let unitsSold = 0;
      let revenue = 0;
      let cost = 0;
      let itemsMissingCost = 0;
      for (const p of productList) {
        unitsSold += p.quantity;
        revenue += p.revenue;
        cost += p.cost;
        if (p.missingCost) itemsMissingCost += 1;
      }
      return {
        month,
        orderCount: orderCountByMonth.get(month) ?? 0,
        unitsSold,
        revenue,
        cost,
        profit: revenue - cost,
        itemsMissingCost,
        products: productList,
      };
    });

  const totals = months.reduce<ProductMarginTotals>(
    (t, m) => ({
      orderCount: t.orderCount + m.orderCount,
      unitsSold: t.unitsSold + m.unitsSold,
      revenue: t.revenue + m.revenue,
      cost: t.cost + m.cost,
      profit: t.profit + m.profit,
      itemsMissingCost: t.itemsMissingCost + m.itemsMissingCost,
    }),
    { orderCount: 0, unitsSold: 0, revenue: 0, cost: 0, profit: 0, itemsMissingCost: 0 }
  );

  const productsMissingCost = Array.from(missingProducts.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  return { months, orders: orderList, totals, productsMissingCost };
}

/**
 * Load the product sales / margin report from the database. Orders come from
 * order_overview_view (order_date/status/customer), line items from order_items
 * (line_total, quantity), and product costs from products.base_cost.
 */
export async function loadProductMarginByMonth(
  supabase: SupabaseClient,
  { from, to }: { from?: string | null; to?: string | null } = {}
): Promise<ProductMarginReport> {
  const [orderRows, itemRows, productRows] = await Promise.all([
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("order_overview_view").select("order_id,order_date,status,customer_name").range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("order_items").select("order_id,product_id,quantity_ordered,line_total").range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("products").select("id,name,base_cost").range(lo, hi)
    ),
  ]);

  const orders: MarginOrderInput[] = orderRows.map((row) => ({
    orderId: str(row.order_id) ?? "",
    orderDate: str(row.order_date),
    status: str(row.status),
    customer: str(row.customer_name),
  }));

  const items: MarginItemInput[] = itemRows.map((row) => ({
    orderId: str(row.order_id) ?? "",
    productId: str(row.product_id) ?? "",
    quantity: toNum(row.quantity_ordered),
    lineTotal: toNum(row.line_total),
  }));

  const products: MarginProductInput[] = productRows.map((row) => ({
    id: str(row.id) ?? "",
    name: str(row.name) ?? "",
    baseCost: row.base_cost == null ? null : toNum(row.base_cost),
  }));

  return buildProductMarginByMonth(orders, items, products, { from, to });
}
