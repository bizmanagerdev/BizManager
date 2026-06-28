import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { isOpenAIConfigured } from "@/lib/openai/config";
import type { MerchantMemory } from "@/lib/financial/cardImport";
import CardImportClient from "./CardImportClient";

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

export default async function ImportExpensesPage() {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const [{ data: projectRows }, { data: propertyRows }, { data: mappingRows }] = await Promise.all([
    supabase.from("projects").select("id,name").order("name", { ascending: true }),
    supabase.from("properties").select("id,name").order("name", { ascending: true }),
    // May not exist before the migration runs — errors are tolerated (data is null).
    supabase
      .from("expense_merchant_mappings")
      .select("merchant_key,business_domain,project_id,property_id"),
  ]);

  const projects: Option[] = ((projectRows ?? []) as Option[]).filter(
    (r) => typeof r.id === "string" && typeof r.name === "string"
  );
  const properties: Option[] = ((propertyRows ?? []) as Option[]).filter(
    (r) => typeof r.id === "string" && typeof r.name === "string"
  );

  type MappingRow = {
    merchant_key: string;
    business_domain: string;
    project_id: string | null;
    property_id: string | null;
  };
  const merchantMemory: MerchantMemory = {};
  for (const row of (mappingRows ?? []) as MappingRow[]) {
    if (!row.merchant_key || !row.business_domain) continue;
    merchantMemory[row.merchant_key] = {
      businessDomain: row.business_domain,
      projectId: row.project_id ?? "",
      propertyId: row.property_id ?? "",
    };
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <CardImportClient
        projects={projects}
        properties={properties}
        smartExtractEnabled={isOpenAIConfigured()}
        merchantMemory={merchantMemory}
      />
    </AppShell>
  );
}
