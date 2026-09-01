import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { CUSTOMER_CORE_SELECT, withLinkColumn } from "@/lib/customers/workerLink";

/**
 * Single-customer read, straight from Supabase — RLS on `customers` already
 * scopes this the same way GET /api/customers/[id] did (the route used the
 * same RLS-bound client with no extra filtering), so this is a like-for-like
 * replacement, not a narrower or broader read.
 */
export async function fetchCustomerCore(
  id: string,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const supabase = createSupabaseBrowserClient();
  const { data } = await withLinkColumn(CUSTOMER_CORE_SELECT, (select) => {
    let query = supabase.from("customers").select(select).eq("id", id);
    if (signal) query = query.abortSignal(signal);
    return query.maybeSingle();
  });
  return data as Record<string, unknown> | null;
}
