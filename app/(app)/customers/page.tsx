import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import CustomersClient from "@/app/(app)/customers/CustomersClient";
import { loadCustomersPage, type CustomerFilterMode } from "@/app/(app)/customers/loadCustomers";

function parseFilterMode(value: string | undefined): CustomerFilterMode {
  return value === "yes" || value === "no" ? value : "all";
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{
    edit_customer_id?: string;
    add_contact_customer_id?: string;
    with_projects?: string;
    with_orders?: string;
    with_debt?: string;
    active_only?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const filters = {
    withProjects: parseFilterMode(params.with_projects),
    withOrders: parseFilterMode(params.with_orders),
    withDebt: parseFilterMode(params.with_debt),
    activeOnly: parseFilterMode(params.active_only),
  };

  const { profile, supabase } = await requireStaffPage();
  const { rows, totalCount, hasMore, error: loadError } = await loadCustomersPage(supabase, {
    page: 1,
    filters,
  });

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        {loadError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת לקוחות: {loadError}</p>
        ) : (
          <CustomersClient
            initialRows={rows}
            initialHasMore={hasMore}
            initialEditCustomerId={
              typeof params.edit_customer_id === "string" && params.edit_customer_id.trim()
                ? params.edit_customer_id.trim()
                : ""
            }
            initialAddContactCustomerId={
              typeof params.add_contact_customer_id === "string" && params.add_contact_customer_id.trim()
                ? params.add_contact_customer_id.trim()
                : ""
            }
            totalCount={totalCount}
            initialFilters={filters}
          />
        )}
      </div>
    </AppShell>
  );
}
