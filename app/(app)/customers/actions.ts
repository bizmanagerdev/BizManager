"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import {
  loadCustomerIdsPassingFilters,
  loadCustomersByIds,
  loadCustomersPage,
} from "./loadCustomers";
import { sanitizeCustomersFilters } from "./customersFilters";

// More ids than any search can match (every customer) — a hand-made call with
// a huge list is cut here rather than sent on as dozens of reads.
const MAX_IDS = 5000;

function sanitizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.trim().length > 0).slice(0, MAX_IDS);
}

/**
 * Fetch the next page of customers for the infinite-scroll list. Re-authenticates
 * on every call (server action), so it is as safe as the page's own load. A
 * failed read comes back as `error` (in Hebrew), for the list to show with a
 * retry — not as an empty page that quietly ends the list.
 */
export async function loadMoreCustomers(page: number, filters: unknown) {
  const { supabase } = await requireProfile();
  const { rows, hasMore, error } = await loadCustomersPage(supabase, {
    page: typeof page === "number" ? page : 1,
    filters: sanitizeCustomersFilters(filters),
  });
  return { rows, hasMore, error };
}

/**
 * Fetch fully-enriched list rows for the customers matched by the search box,
 * so search results show real orders/projects counts and money totals. With
 * `filters`, only those that pass them.
 */
export async function loadCustomerRowsByIds(customerIds: string[], filters?: unknown) {
  const { supabase } = await requireProfile();
  const { rows, error } = await loadCustomersByIds(
    supabase,
    sanitizeIds(customerIds),
    filters === undefined ? undefined : sanitizeCustomersFilters(filters)
  );
  return { rows, error };
}

/** Which of a search's matches pass the list's filters, best match first. */
export async function findCustomerIdsPassingFilters(customerIds: string[], filters: unknown) {
  const { supabase } = await requireProfile();
  return loadCustomerIdsPassingFilters(supabase, sanitizeIds(customerIds), sanitizeCustomersFilters(filters));
}

// The customer search index is a GET now: app/api/search-index/[kind]/route.ts.
