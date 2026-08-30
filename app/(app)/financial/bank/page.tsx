import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { loadAccountsOverview } from "@/lib/accounts";
import { fetchLoans } from "@/lib/loans";
import type { MerchantMemory } from "@/lib/financial/cardImport";
import { propertyDisplayName } from "@/lib/properties";
import BankClient from "./BankClient";

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

/**
 * חשבונות — every account's balance, and the register of whichever one is open.
 *
 * The register is meant to be read next to the bank's own site in a split
 * window, so the page carries a quick-entry row for typing what's missing
 * straight in. (A previous version imported and matched statement files; it was
 * more machinery than the job needed and was removed.)
 */
export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { profile, supabase } = await requireProfile();
  // חשבונות (balances/management) is admin-only. Office still assigns an account
  // when recording payments via the AccountSelect picker (read-only GET), just not here.
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const params = await searchParams;
  const [accounts, loans, { data: projectRows }, { data: propertyRows }, { data: mappingRows }] = await Promise.all([
    loadAccountsOverview(supabase),
    // For the register's inline "עריכת הלוואה"/"עריכת החזר" — a loan/loan_repayment
    // row needs the full computed Loan shape (outstanding, plannedInstallments…),
    // not just what the ledger scan keeps for display.
    fetchLoans(supabase),
    supabase.from("projects").select("id,name").order("created_at", { ascending: false }).limit(300),
    // For the expense-edit dialog's property picker (property_management domain)
    // — same list CashFlowPageContent.tsx feeds ExpenseDialog with, just fetched
    // here too since this page's own edit dialog wasn't getting it at all
    // (2026-08-27, "look around for more places with this issue": editing an
    // unlinked expense here and switching it to ניהול נכסים showed "no
    // properties available" even though properties exist).
    supabase.from("properties").select("id,name,address,is_active").order("address", { ascending: true }).limit(999),
    // Merchant memory — how a description like this was filed last time, so the
    // quick row fills its own שיוך.
    supabase
      .from("expense_merchant_mappings")
      .select("merchant_key,business_domain,project_id,property_id,category"),
  ]);

  const projects: Option[] = ((projectRows ?? []) as Option[]).filter(
    (row) => typeof row.id === "string" && typeof row.name === "string"
  );
  const recurringProperties = ((propertyRows ?? []) as Array<{
    id: string;
    name: string | null;
    address: string | null;
    is_active: boolean | null;
  }>)
    .filter((row) => row.is_active !== false)
    .map((row) => ({ id: row.id, label: propertyDisplayName({ name: row.name, address: row.address ?? "" }) }))
    .filter((row) => row.id && row.label);

  const merchantMemory: MerchantMemory = {};
  for (const row of (mappingRows ?? []) as Array<{
    merchant_key: string;
    business_domain: string;
    project_id: string | null;
    property_id: string | null;
    category: string | null;
  }>) {
    if (!row.merchant_key || !row.business_domain) continue;
    merchantMemory[row.merchant_key] = {
      businessDomain: row.business_domain,
      projectId: row.project_id ?? "",
      propertyId: row.property_id ?? "",
      category: row.category ?? "",
    };
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <BankClient
        accounts={accounts}
        loans={loans}
        initialAccountId={params.account ?? ""}
        projects={projects}
        recurringProperties={recurringProperties}
        merchantMemory={merchantMemory}
      />
    </AppShell>
  );
}
