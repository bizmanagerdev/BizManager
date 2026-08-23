"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { hasDeliveriesAccess } from "@/lib/auth/roleAccess";
import { loadOrdersPage, type OrdersFilters } from "./loadOrders";
import {
  loadPriceListPage,
  loadInventoryListPage,
  type ProductsFilters,
} from "./loadProducts";
import { loadDeliveriesPage, type DeliveriesFilters } from "./loadDeliveries";

/** Fetch the next page of orders (open or closed) for the infinite-scroll list. */
export async function loadMoreOrders(page: number, filters: OrdersFilters) {
  const { supabase } = await requireProfile();
  const { rows, hasMore } = await loadOrdersPage(supabase, { page, filters });
  return { rows, hasMore };
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
