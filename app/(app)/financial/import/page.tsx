// Aliased: this route also exports its own `dynamic` (route-segment config,
// below) which would otherwise collide with next/dynamic's default export.
import nextDynamic from "next/dynamic";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { isOpenAIConfigured } from "@/lib/openai/config";
import { buildKnownCards, type MerchantMemory } from "@/lib/financial/cardImport";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { propertyDisplayName } from "@/lib/properties";
import { isForeignCurrency, type CurrencyCode } from "@/lib/fx/currencies";
import ImportSkeleton from "./ImportSkeleton";

// The same placeholder as loading.tsx while the client's code loads.
const CardImportClient = nextDynamic(() => import("./CardImportClient"), {
  loading: () => <ImportSkeleton smartExtractEnabled={isOpenAIConfigured()} />,
});

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

export default async function ImportExpensesPage() {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const [
    { data: projectRows },
    { data: propertyRows },
    { data: mappingRows },
    { data: cardMappingRows },
    chargeRows,
    statementRowCards,
    { data: cardAccountRows },
    { data: usStatementRows },
  ] = await Promise.all([
    supabase.from("projects").select("id,name").order("name", { ascending: true }),
    supabase.from("properties").select("id,name,address").order("address", { ascending: true }),
    // May not exist before the migration runs — errors are tolerated (data is null).
    supabase
      .from("expense_merchant_mappings")
      .select("merchant_key,business_domain,project_id,property_id"),
    // The cards on record, offered in the review step for lines whose file names no
    // card. Errors are tolerated — the import still works, just without suggestions.
    supabase.from("card_account_mappings").select("card_label,account:accounts(name)"),
    fetchAllPaged<{ card_label: string | null; charge_date: string | null }>((from, to) =>
      supabase.from("card_statement_charges").select("card_label,charge_date").order("id").range(from, to)
    ).catch(() => []),
    // ~1,300 rows and growing: one answer stops at 1,000 rows without saying so.
    fetchAllPaged<{ card_label: string | null }>((from, to) =>
      supabase.from("card_statement_rows").select("card_label").order("id").range(from, to)
    ).catch(() => []),
    // The US cards kept as their own account (2026-10-25), for a US statement.
    supabase.from("accounts").select("id,name,currency,account_number").eq("kind", "card").eq("is_active", true).order("name"),
    // The US statements already uploaded — tolerated before their migration runs.
    supabase.from("card_statements").select("id,card_account_id,period_end,file_name").not("card_account_id", "is", null),
  ]);

  const projects: Option[] = ((projectRows ?? []) as Option[]).filter(
    (r) => typeof r.id === "string" && typeof r.name === "string"
  );
  const properties: Option[] = ((propertyRows ?? []) as { id: string; name: string | null; address: string }[])
    .filter((r) => typeof r.id === "string" && typeof r.address === "string")
    .map((r) => ({ id: r.id, name: propertyDisplayName(r) }));

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

  type CardMappingRow = { card_label: string | null; account: { name: string | null } | { name: string | null }[] | null };
  const knownCards = buildKnownCards({
    mappings: ((cardMappingRows ?? []) as CardMappingRow[]).map((r) => ({
      card_label: r.card_label,
      account_name: (Array.isArray(r.account) ? r.account[0]?.name : r.account?.name) ?? null,
    })),
    charges: chargeRows,
    rowLabels: statementRowCards.map((r) => r.card_label),
  });

  type CardAccountRow = { id: string; name: string | null; currency: string | null; account_number: string | null };
  const cardAccounts = ((cardAccountRows ?? []) as CardAccountRow[]).map((a) => ({
    id: a.id,
    name: a.name?.trim() || "כרטיס",
    currency: (isForeignCurrency(a.currency) ? a.currency : "ILS") as CurrencyCode,
    accountNumber: a.account_number?.trim() || null,
  }));
  type UsStatementRow = { id: string; card_account_id: string; period_end: string | null; file_name: string | null };
  const usStatements = ((usStatementRows ?? []) as UsStatementRow[]).map((s) => ({
    id: s.id,
    cardAccountId: s.card_account_id,
    periodEnd: s.period_end,
    fileName: s.file_name ?? "",
  }));

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <CardImportClient
        projects={projects}
        properties={properties}
        smartExtractEnabled={isOpenAIConfigured()}
        merchantMemory={merchantMemory}
        knownCards={knownCards}
        cardAccounts={cardAccounts}
        usStatements={usStatements}
      />
    </AppShell>
  );
}
