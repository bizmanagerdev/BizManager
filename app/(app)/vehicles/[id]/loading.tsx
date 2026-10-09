import AppShell from "@/components/layout/AppShell";
import VehiclePageSkeleton from "@/app/(app)/vehicles/[id]/VehiclePageSkeleton";

// Streamed instantly while this vehicle's data loads, so TTFB = time-to-shell,
// not time-to-all-queries. The page's own shape (VehiclePageSkeleton): its
// header card, the mileage and expiry rows, the expenses / tasks / documents
// cards.
export default function VehicleDetailLoading() {
  return (
    <AppShell>
      <VehiclePageSkeleton routeLoading />
    </AppShell>
  );
}
