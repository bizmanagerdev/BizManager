import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { fetchProperties } from "@/lib/properties";
import PropertiesClient from "./PropertiesClient";

export const revalidate = 30;

export default async function PropertiesPage() {
  const { profile, supabase } = await requireStaffPage();
  const properties = await fetchProperties(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PropertiesClient properties={properties} />
    </AppShell>
  );
}
