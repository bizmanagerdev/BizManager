import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/requireProfile";
import { hasDeliveriesAccess, isStaffRole } from "@/lib/auth/roleAccess";
import PageTitle from "@/components/layout/PageTitle";
import SalesDeliveriesQueue from "@/app/(app)/sales/SalesDeliveriesQueue";
import { DELIVERY_REGIONS } from "@/lib/ui/cities";
import { loadDeliveriesPage } from "@/app/(app)/sales/loadDeliveries";

export const revalidate = 30;

/**
 * The delivery run, on its own route so a WORKER can reach it — /sales is
 * staff-only (orders, money, price list, stock), and the deliveries queue was
 * only ever a tab inside it.
 *
 * Same component, same loader, same server action as /sales?tab=deliveries, so
 * the two can't drift; the only difference is that a worker doesn't get the link
 * through to the full order screen (canOpenOrder). Staff keep using the tab —
 * this route works for them too and is what a shared delivery link should point
 * at.
 */
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams?: Promise<{ region?: string; customer_id?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const regionFilter =
    params.region === "צפון" || params.region === "מרכז" || params.region === "דרום"
      ? params.region
      : null;
  const customerId =
    typeof params.customer_id === "string" && params.customer_id.trim()
      ? params.customer_id.trim()
      : null;

  const { profile, supabase } = await requireProfile();
  if (!hasDeliveriesAccess(profile.role, profile.deliveries_access)) redirect("/no-access");
  const { deliveries, totalCount, hasMore, error } = await loadDeliveriesPage(supabase, {
    page: 1,
    filters: { customerId },
  });

  const buildHref = (region: string | null) => {
    const next = new URLSearchParams();
    if (customerId) next.set("customer_id", customerId);
    if (region) next.set("region", region);
    const query = next.toString();
    return query ? `/deliveries?${query}` : "/deliveries";
  };

  const regionLinks = [
    { label: "הכל", value: null },
    ...DELIVERY_REGIONS.map((region) => ({ label: region, value: region })),
  ].map(({ label, value }) => ({
    label,
    value,
    href: buildHref(value),
    active: regionFilter === value,
  }));

  return (
    <div className="space-y-4" dir="rtl">
      <PageTitle title="משלוחים" subtitle={`${totalCount} פתוחים`} />
      {error ? (
        <p className="text-sm text-destructive">שגיאה בטעינת משלוחים: {error}</p>
      ) : (
        <SalesDeliveriesQueue
          initialDeliveries={deliveries}
          initialHasMore={hasMore}
          regionFilter={regionFilter}
          regionLinks={regionLinks}
          totalCount={totalCount}
          customerId={customerId}
          canOpenOrder={isStaffRole(profile.role)}
        />
      )}
    </div>
  );
}
