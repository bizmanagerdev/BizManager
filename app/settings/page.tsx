import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import SettingsTabs from "@/app/settings/SettingsTabs";
import { loadMorningSettings, type MorningSettings } from "@/lib/morning/settings";
import { getCurrentVatRate } from "@/lib/settings/vat";
import type { RecurringExpenseTemplateItem } from "@/app/financial/RecurringExpensesManager";

type Row = Record<string, unknown>;

function getString(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  return typeof v === "string" ? v : null;
}

function getNumber(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

function looksLikeMissingSchema(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache");
}

export default async function SettingsPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const isAdmin = true;
  const canManage = true;

  // ── Shared lookups ──────────────────────────────────────────────────────
  const [usersResult, projectsResult, propertiesResult] = await Promise.all([
    supabase.from("users").select("id,full_name,email").eq("active", true)
      .order("full_name", { ascending: true }).range(0, 499),
    supabase.from("project_dashboard_view").select("id,name,customer_name")
      .order("updated_at", { ascending: false }).range(0, 999),
    supabase.from("properties").select("id,address,is_active")
      .order("address", { ascending: true }).range(0, 999),
  ]);

  const users = ((usersResult.data ?? []) as Row[])
    .map((r) => ({ id: getString(r, "id") ?? "", label: (getString(r, "full_name") ?? getString(r, "email") ?? "").trim() }))
    .filter((u) => u.id && u.label);

  const projectOptions = ((projectsResult.data ?? []) as Row[])
    .map((r) => {
      const id = getString(r, "id") ?? "";
      const name = getString(r, "name") ?? "";
      const customer = getString(r, "customer_name");
      return { id, label: customer ? `${name} (${customer})` : name };
    })
    .filter((o) => o.id && o.label);

  const propertyOptions = ((propertiesResult.data ?? []) as Row[])
    .filter((r) => r.is_active !== false)
    .map((r) => ({ id: getString(r, "id") ?? "", label: getString(r, "address") ?? "" }))
    .filter((o) => o.id && o.label);

  // ── Recurring expenses ──────────────────────────────────────────────────
  let expenseTemplates: RecurringExpenseTemplateItem[] = [];
  let expenseMissingSchema = false;
  let orderOptions: Array<{ id: string; label: string }> = [];

  if (canManage) {
    const [expResult, ordersResult] = await Promise.all([
      supabase
        .from("recurring_expense_templates")
        .select("id,template_name,category,amount,description_template,notes_template,business_domain,project_id,order_id,property_id,included_in_base_price,billed_to_customer,project_expense_notes_template,frequency,create_day_of_month,expense_day_of_month,create_month_of_year,expense_month_of_year,start_date,end_date,is_active")
        .order("created_at", { ascending: true }),
      supabase
        .from("order_overview_view")
        .select("order_id,customer_name,order_date")
        .order("order_date", { ascending: false })
        .range(0, 499),
    ]);

    expenseMissingSchema = Boolean(expResult.error?.message && looksLikeMissingSchema(expResult.error.message));

    if (!expenseMissingSchema) {
      expenseTemplates = ((expResult.data ?? []) as Row[]).map((r) => ({
        id: getString(r, "id") ?? "",
        template_name: getString(r, "template_name") ?? "",
        category: getString(r, "category") ?? "",
        amount: getNumber(r, "amount") ?? 0,
        description_template: getString(r, "description_template"),
        notes_template: getString(r, "notes_template"),
        business_domain: getString(r, "business_domain") ?? "general_business",
        project_id: getString(r, "project_id"),
        order_id: getString(r, "order_id"),
        property_id: getString(r, "property_id"),
        included_in_base_price: r.included_in_base_price === true,
        billed_to_customer: r.billed_to_customer === true,
        project_expense_notes_template: getString(r, "project_expense_notes_template"),
        frequency: getString(r, "frequency") === "yearly" ? "yearly" : "monthly",
        create_day_of_month: getNumber(r, "create_day_of_month") ?? 1,
        expense_day_of_month: getNumber(r, "expense_day_of_month") ?? 1,
        create_month_of_year: getNumber(r, "create_month_of_year"),
        expense_month_of_year: getNumber(r, "expense_month_of_year"),
        start_date: getString(r, "start_date"),
        end_date: getString(r, "end_date"),
        is_active: r.is_active !== false,
      })) as RecurringExpenseTemplateItem[];
    }

    orderOptions = ((ordersResult.data ?? []) as Row[]).map((r) => {
      const id = getString(r, "order_id") ?? "";
      const customer = getString(r, "customer_name") ?? "";
      const date = getString(r, "order_date") ?? "";
      return { id, label: customer ? `${customer} (${date})` : id };
    }).filter((o) => o.id);
  }

  // ── Morning integration (admin only) ────────────────────────────────────
  let morningSettings: MorningSettings | null = null;
  if (isAdmin) {
    morningSettings = await loadMorningSettings(supabase);
  }

  // ── VAT rate (admin only) ────────────────────────────────────────────────
  const vatRate = isAdmin ? await getCurrentVatRate(supabase) : 0.18;

  // ── Audit-logging switch (admin only) ────────────────────────────────────
  let auditLoggingEnabled = true;
  if (isAdmin) {
    const { data: auditCfg } = await supabase
      .from("business_settings")
      .select("audit_logging_enabled")
      .eq("id", true)
      .maybeSingle();
    auditLoggingEnabled =
      (auditCfg as { audit_logging_enabled?: boolean } | null)?.audit_logging_enabled ?? true;
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <SettingsTabs
        isAdmin={isAdmin}
        users={users}
        expenseTemplates={expenseTemplates}
        expenseProjects={projectOptions}
        expenseProperties={propertyOptions}
        expenseOrders={orderOptions}
        expenseMissingSchema={expenseMissingSchema}
        morningSettings={morningSettings}
        vatRate={vatRate}
        auditLoggingEnabled={auditLoggingEnabled}
      />
    </AppShell>
  );
}
