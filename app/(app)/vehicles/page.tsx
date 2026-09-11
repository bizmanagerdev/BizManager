import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { hasSectionAccess, isStaffRole } from "@/lib/auth/roleAccess";
import { fetchVehicles } from "@/lib/vehicles";
import VehiclesClient from "./VehiclesClient";

export const revalidate = 30;

export default async function VehiclesPage() {
  const { profile, supabase } = await requireProfile();

  // Staff always have it; a worker needs the admin-granted "vehicles" section
  // (Salary Center worker-edit dialog) — same full access staff get, nothing
  // reduced.
  if (!isStaffRole(profile.role) && !hasSectionAccess(profile.role, profile.section_access, "vehicles")) {
    redirect("/no-access");
  }

  const vehicles = await fetchVehicles(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <VehiclesClient vehicles={vehicles} />
      </div>
    </AppShell>
  );
}
