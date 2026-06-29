import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { loadTaxToPay } from "@/lib/financial/taxes";
import TaxesClient from "./TaxesClient";

export const dynamic = "force-dynamic";

export default async function TaxesPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const data = await loadTaxToPay(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <TaxesClient data={data} />
    </AppShell>
  );
}
