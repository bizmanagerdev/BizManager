"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { hasDeliveriesAccess } from "@/lib/auth/roleAccess";
import { findInsideMatches, type InsideMatches } from "@/lib/global-search";
import {
  loadOrdersByIds,
  loadOrdersPage,
  type OrdersFilters,
} from "./loadOrders";
import {
  loadPriceListPage,
  loadInventoryListPage,
  type ProductsFilters,
} from "./loadProducts";
import { loadDeliveriesPage, type DeliveriesFilters } from "./loadDeliveries";
import { loadPickingListSource } from "./loadPickingList";

/** Fetch the next page of orders (open or closed) for the infinite-scroll list. */
export async function loadMoreOrders(page: number, filters: OrdersFilters) {
  const { supabase } = await requireProfile();
  const { rows, hasMore } = await loadOrdersPage(supabase, { page, filters });
  return { rows, hasMore };
}

/** Fetch enriched order rows (products, stock, pending payment methods) for an explicit id list. */
export async function loadOrderRowsByIds(ids: string[]) {
  const { supabase } = await requireProfile();
  const rows = await loadOrdersByIds(supabase, ids);
  return { rows };
}

// The order search index is a GET now: app/api/search-index/[kind]/route.ts.

/**
 * Orders reached through anything inside them — the "deep content" matches the
 * instant customer/branch index can't see, with why each one came up. Run in
 * the background after the instant paint.
 */
export async function findOrderContentMatches(query: string): Promise<InsideMatches> {
  const { supabase, profile } = await requireProfile();
  // Everything inside an order: its comments, products and lines, its payments
  // (amount, date, check, reference), its dates and hours (owner, 2026-10-19:
  // "if I see a bank charge for 1447 I should be able to search orders and find it").
  return findInsideMatches(supabase, { query, kind: "order", viewerRole: profile.role, viewerId: profile.id });
}

/** Fetch the next page of price-list products for the infinite-scroll list. */
export async function loadMorePriceList(page: number, filters: ProductsFilters) {
  const { supabase } = await requireProfile();
  const { products, hasMore } = await loadPriceListPage(supabase, { page, filters });
  return { rows: products, hasMore };
}

/** Fetch the next page of inventory items for the infinite-scroll list. */
export async function loadMoreInventory(page: number, filters: ProductsFilters) {
  const { supabase } = await requireProfile();
  const { items, hasMore } = await loadInventoryListPage(supabase, { page, filters });
  return { rows: items, hasMore };
}

/** Fetch the next page of open deliveries for the infinite-scroll queue. */
export async function loadMoreDeliveries(page: number, filters: DeliveriesFilters) {
  const { supabase, profile } = await requireProfile();
  if (!hasDeliveriesAccess(profile.role, profile.section_access)) {
    throw new Error("No access");
  }
  const { deliveries, hasMore } = await loadDeliveriesPage(supabase, { page, filters });
  return { rows: deliveries, hasMore };
}

/** Every open delivery's outstanding line items, for the warehouse picking list. */
export async function loadPickingList() {
  const { supabase, profile } = await requireProfile();
  if (!hasDeliveriesAccess(profile.role, profile.section_access)) {
    throw new Error("No access");
  }
  return loadPickingListSource(supabase);
}
