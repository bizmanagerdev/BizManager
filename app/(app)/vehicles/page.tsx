import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { fetchVehicles } from "@/lib/vehicles";
import VehiclesClient from "./VehiclesClient";

export const revalidate = 30;

export default async function VehiclesPage() {
  const { profile, supabase } = await requireProfile();

  // Managing vehicles + seeing their money is staff-level (matches nav gating).
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const vehicles = await fetchVehicles(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <VehiclesClient vehicles={vehicles} />
    </AppShell>
  );
}
