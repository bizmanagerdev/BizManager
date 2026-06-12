"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { loadCustomersByIds, loadCustomersPage, type CustomersFilters } from "./loadCustomers";

/**
 * Fetch the next page of customers for the infinite-scroll list. Re-authenticates
 * on every call (server action), so it is as safe as the page's own load.
 */
export async function loadMoreCustomers(page: number, filters: CustomersFilters) {
  const { supabase } = await requireProfile();
  const { rows, hasMore } = await loadCustomersPage(supabase, { page, filters });
  return { rows, hasMore };
}

/**
 * Fetch fully-enriched list rows for the customers matched by the search box,
 * so search results show real orders/projects counts and money totals.
 */
export async function loadCustomerRowsByIds(customerIds: string[]) {
  const { supabase } = await requireProfile();
  const { rows } = await loadCustomersByIds(supabase, customerIds);
  return { rows };
}
