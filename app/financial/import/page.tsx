import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import CardImportClient from "./CardImportClient";

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

export default async function ImportExpensesPage() {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const [{ data: projectRows }, { data: propertyRows }] = await Promise.all([
    supabase.from("projects").select("id,name").order("name", { ascending: true }),
    supabase.from("properties").select("id,name").order("name", { ascending: true }),
  ]);

  const projects: Option[] = ((projectRows ?? []) as Option[]).filter(
    (r) => typeof r.id === "string" && typeof r.name === "string"
  );
  const properties: Option[] = ((propertyRows ?? []) as Option[]).filter(
    (r) => typeof r.id === "string" && typeof r.name === "string"
  );

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <CardImportClient projects={projects} properties={properties} />
    </AppShell>
  );
}
