"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { hasDeliveriesAccess } from "@/lib/auth/roleAccess";
import { findOrderIdsMatchingContent } from "@/lib/search/findMatchingChildIds";
import {
  loadOrdersByIds,
  loadOrdersPage,
  loadOrderSearchIndexRows,
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

/**
 * Load the full lightweight order index for the client-side in-memory search
 * (instant order type-ahead on the orders list). Re-authenticates per call.
 */
export async function loadOrderSearchIndex() {
  const { supabase } = await requireProfile();
  const orders = await loadOrderSearchIndexRows(supabase);
  return { orders };
}

/**
 * Order ids reached only through a line item's product/notes or the order's
 * own notes — the "deep content" matches the instant customer/branch index
 * can't see. Run in the background after the instant paint.
 */
export async function findOrderContentMatches(query: string) {
  const { supabase } = await requireProfile();
  const { ids } = await findOrderIdsMatchingContent(supabase, query, 300);
  return { ids };
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
  if (!hasDeliveriesAccess(profile.role, profile.deliveries_access)) {
    throw new Error("No access");
  }
  const { deliveries, hasMore } = await loadDeliveriesPage(supabase, { page, filters });
  return { rows: deliveries, hasMore };
}

/** Every open delivery's outstanding line items, for the warehouse picking list. */
export async function loadPickingList() {
  const { supabase, profile } = await requireProfile();
  if (!hasDeliveriesAccess(profile.role, profile.deliveries_access)) {
    throw new Error("No access");
  }
  return loadPickingListSource(supabase);
}
