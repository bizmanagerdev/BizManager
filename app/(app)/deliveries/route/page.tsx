import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/requireProfile";
import { hasDeliveriesAccess, isStaffRole } from "@/lib/auth/roleAccess";
import PageTitle from "@/components/layout/PageTitle";
import { loadDeliveriesPage, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { plannerStops } from "@/lib/routes/planner-stops";
import RoutePlanner from "./RoutePlannerLoader";

export const dynamic = "force-dynamic";

/** Ten pages of the deliveries list: far more open deliveries than a day's run. */
const MAX_PAGES = 10;

/**
 * The delivery route planner (owner, 2026-10-26): pick the stops, where to
 * leave from and end, the order of regions if it matters ("first Jerusalem,
 * then north"), and get the best order from Google's real driving times — on a
 * map, with why it's the best. Reached from the deliveries list's "מסלול".
 * It needs a connection (Google is asked), so the stops come from the server.
 */
export default async function DeliveryRoutePage() {
  const { profile, supabase } = await requireProfile();
  if (!hasDeliveriesAccess(profile.role, profile.section_access)) redirect("/no-access");

  const deliveries: DeliveryItem[] = [];
  let error: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await loadDeliveriesPage(supabase, { page, filters: { customerId: null } });
    if (result.error) {
      error = result.error;
      break;
    }
    deliveries.push(...result.deliveries);
    if (!result.hasMore) break;
  }
  const stops = plannerStops(deliveries);

  return (
    <div className="space-y-4" dir="rtl">
      <PageTitle title="תכנון מסלול" subtitle={`${stops.length} עצירות פתוחות`} />
      {error ? (
        <p className="text-sm text-destructive">שגיאה בטעינת משלוחים: {error}</p>
      ) : (
        <RoutePlanner stops={stops} canEditAddress={isStaffRole(profile.role)} />
      )}
    </div>
  );
}
