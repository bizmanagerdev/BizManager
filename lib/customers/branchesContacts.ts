import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Row = Record<string, unknown>;

/** RLS ("contacts": admin/office ALL) matches the old /api/customer-contacts/list route exactly. */
export async function fetchCustomerContactsDirect(customerId: string, signal?: AbortSignal): Promise<Row[]> {
  let query = createSupabaseBrowserClient()
    .from("contacts")
    .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes")
    .eq("customer_id", customerId)
    .order("is_primary", { ascending: false })
    .order("full_name", { ascending: true });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as Row[];
}

/**
 * RLS ("customer_branches_worker_select" + "customer_branches_office_manage")
 * matches the old /api/customer-branches/list route — a worker can read too.
 */
export async function fetchCustomerBranchesDirect(customerId: string, signal?: AbortSignal): Promise<Row[]> {
  let query = createSupabaseBrowserClient()
    .from("customer_branches")
    .select("id,customer_id,name,address,phone,active")
    .eq("customer_id", customerId)
    .order("name", { ascending: true });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as Row[];
}

export type BranchPatch = { name?: string; address?: string | null; phone?: string | null; active?: boolean };

/**
 * RLS ("customer_branches_office_manage", admin/office) matches the old
 * /api/customer-branches/update route exactly — no worker write policy.
 */
export async function updateCustomerBranchDirect(
  id: string,
  patch: BranchPatch
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await createSupabaseBrowserClient()
    .from("customer_branches")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: "Branch was not updated" };
  return { ok: true };
}
