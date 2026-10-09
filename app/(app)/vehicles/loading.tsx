import AppShell from "@/components/layout/AppShell";
import VehiclesLoadingBody from "@/app/(app)/vehicles/VehiclesLoadingBody";

// Streamed instantly while the vehicles list loads, so TTFB = time-to-shell.
// The list's own shape (VehiclesSkeleton — the sort button and the vehicle
// cards with their expiry rows) to keep the swap shift-free; on the way to a
// vehicle's page, that page's shape instead.
export default function VehiclesLoading() {
  return (
    <AppShell>
      <VehiclesLoadingBody />
    </AppShell>
  );
}
