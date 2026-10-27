import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAccountsOverview, type AccountWithLedger } from "@/lib/accounts";
import { fetchLoans, type Loan } from "@/lib/loans";
import { loadTodayFxRates } from "@/lib/fx/rates";
import type { TodayFxRates } from "@/lib/fx/currencies";
import { fetchAllPagedResult } from "@/lib/supabase/paginate";
import type { MerchantMemory } from "@/lib/financial/cardImport";
import { propertyDisplayName } from "@/lib/properties";

type Option = { id: string; name: string };

/** Everything the accounts page (/financial/bank) draws, but the open account. */
export type BankPageData = {
  accounts: AccountWithLedger[];
  /** At least one money table couldn't be read — the balances are understated. */
  dataIncomplete: boolean;
  /**
   * For the register's inline "עריכת הלוואה"/"עריכת החזר" — a loan/loan_repayment
   * row needs the full computed Loan shape (outstanding, plannedInstallments…),
   * not just what the ledger scan keeps for display.
   */
  loans: Loan[];
  /** For the quick-entry row above the register. */
  projects: Option[];
  /** For the expense-edit dialog's property picker. */
  recurringProperties: Array<{ id: string; label: string }>;
  /** How a description like this was filed last time, so the quick row fills its own שיוך. */
  merchantMemory: MerchantMemory;
  /** A US$ or C$ account's balance in shekels, at today's rate. */
  fxRates: TodayFxRates;
};

/**
 * The accounts page's data — read on the server, and the same reads on the
 * device's copy (lib/powersync/dashboard-local.ts, "bankPage"), so the two
 * can't drift apart.
 */
export async function loadBankPage(supabase: SupabaseClient): Promise<BankPageData> {
  const [accounts, loans, { data: projectRows }, { data: propertyRows }, { data: mappingRows }, fxRates] = await Promise.all([
    loadAccountsOverview(supabase),
    fetchLoans(supabase),
    supabase.from("projects").select("id,name").order("created_at", { ascending: false }).order("id").limit(300),
    // For the expense-edit dialog's property picker (property_management domain)
    // — same list CashFlowPageContent.tsx feeds ExpenseDialog with, just fetched
    // here too since this page's own edit dialog wasn't getting it at all
    // (2026-08-27, "look around for more places with this issue": editing an
    // unlinked expense here and switching it to ניהול נכסים showed "no
    // properties available" even though properties exist).
    supabase.from("properties").select("id,name,address,is_active").order("address", { ascending: true }).order("id").limit(999),
    // Merchant memory — every page of it (539 rows on 2026-10-27; an unpaged
    // read stops at 1,000).
    fetchAllPagedResult((from, to) =>
      supabase
        .from("expense_merchant_mappings")
        .select("merchant_key,business_domain,project_id,property_id,category")
        .order("id")
        .range(from, to)
    ),
    loadTodayFxRates(supabase),
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

  // A plain array: the overview's dataIncomplete rides on it as a property,
  // which a stored copy of the page (JSON) wouldn't keep.
  return {
    accounts: [...accounts],
    dataIncomplete: accounts.dataIncomplete,
    loans,
    projects,
    recurringProperties,
    merchantMemory,
    fxRates,
  };
}
