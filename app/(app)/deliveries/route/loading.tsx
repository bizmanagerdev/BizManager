import AppShell from "@/components/layout/AppShell";
import RoutePlannerSkeleton from "./RoutePlannerSkeleton";

// The route planner's own shape while its stops load — not the deliveries
// list's (../loading.tsx).
export default function DeliveryRouteLoading() {
  return (
    <AppShell>
      <div className="space-y-4" dir="rtl" data-route-loading="true">
        <RoutePlannerSkeleton />
      </div>
    </AppShell>
  );
}
