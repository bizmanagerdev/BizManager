import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { Card, CardContent } from "@/components/ui/card";
import { ensureRecurringExpensesForDate } from "@/lib/recurring-expenses";
import { loadPaymentCalendarItems, type PaymentCalendarItem } from "@/lib/payables";
import { loadAccounts, type Account } from "@/lib/accounts";
import { propertyDisplayName } from "@/lib/properties";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import PaymentsHubClient from "./PaymentsHubClient";

export const revalidate = 0;

type Row = Record<string, unknown>;
type Option = { id: string; label: string };

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

// "לוח תשלומים" — the home for all expense management. Two tabs:
//   • יומן — the outgoing-payments calendar (every upcoming payment: unpaid/
//     scheduled expenses, recurring bills, loan repayments, worker wages, plus
//     hand-added payments). Add a payment to a day, mark it paid, split it.
//   • הוצאות קבועות — the recurring-expense templates (moved out of Settings).
export default async function PaymentsCalendarPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") redirect("/dashboard");

  // Materialize any recurring expenses due up to today before reading the ledger.
  await ensureRecurringExpensesForDate(supabase).catch(() => undefined);

  let items: PaymentCalendarItem[] = [];
  let todayIso = new Date().toISOString().slice(0, 10);
  let error: string | null = null;
  try {
    const result = await loadPaymentCalendarItems(supabase);
    items = result.items;
    todayIso = result.todayIso;
  } catch (err) {
    error = (err as { message?: string })?.message ?? "שגיאה בטעינת התשלומים";
  }

  // ── Recurring templates + source lookups (for the הוצאות קבועות tab and the
  //    expense dialog's domain-link pickers) ────────────────────────────────
  const [expResult, projectsResult, propertiesResult, ordersResult, accounts] = await Promise.all([
    supabase
      .from("recurring_expense_templates")
      .select("id,template_name,category,amount,is_variable_amount,auto_paid,reminder_work_days_before,description_template,notes_template,business_domain,project_id,order_id,property_id,account_id,included_in_base_price,billed_to_customer,project_expense_notes_template,frequency,interval_months,create_day_of_month,expense_day_of_month,create_month_of_year,expense_month_of_year,start_date,end_date,is_active")
      .order("created_at", { ascending: true }),
    supabase.from("project_dashboard_view").select("id,name,customer_name")
      .order("updated_at", { ascending: false }).range(0, 999),
    supabase.from("properties").select("id,name,address,is_active")
      .order("address", { ascending: true }).range(0, 999),
    supabase.from("order_overview_view").select("order_id,customer_name,order_date")
      .order("order_date", { ascending: false }).range(0, 499),
    loadAccounts(supabase).catch(() => [] as Account[]),
  ]);

  const expenseMissingSchema = Boolean(expResult.error?.message && looksLikeMissingSchema(expResult.error.message));

  const templates: RecurringExpenseTemplateItem[] = expenseMissingSchema
    ? []
    : ((expResult.data ?? []) as Row[]).map((r) => ({
        id: getString(r, "id") ?? "",
        template_name: getString(r, "template_name") ?? "",
        category: getString(r, "category") ?? "",
        amount: getNumber(r, "amount") ?? 0,
        is_variable_amount: r.is_variable_amount === true,
        auto_paid: r.auto_paid === true,
        reminder_work_days_before: getNumber(r, "reminder_work_days_before"),
        description_template: getString(r, "description_template"),
        notes_template: getString(r, "notes_template"),
        business_domain: getString(r, "business_domain") ?? "general_business",
        project_id: getString(r, "project_id"),
        order_id: getString(r, "order_id"),
        property_id: getString(r, "property_id"),
        account_id: getString(r, "account_id"),
        included_in_base_price: r.included_in_base_price === true,
        billed_to_customer: r.billed_to_customer === true,
        project_expense_notes_template: getString(r, "project_expense_notes_template"),
        frequency: getString(r, "frequency") === "yearly" ? "yearly" : "monthly",
        interval_months: getNumber(r, "interval_months") ?? 1,
        create_day_of_month: getNumber(r, "create_day_of_month") ?? 1,
        expense_day_of_month: getNumber(r, "expense_day_of_month") ?? 1,
        create_month_of_year: getNumber(r, "create_month_of_year"),
        expense_month_of_year: getNumber(r, "expense_month_of_year"),
        start_date: getString(r, "start_date"),
        end_date: getString(r, "end_date"),
        is_active: r.is_active !== false,
      })) as RecurringExpenseTemplateItem[];

  // Every recurring calendar item (forecast OR already materialized) should show
  // the template NAME — not the free-text description/category — matching the
  // recurring-templates list. Forecasts already carry the name; paid items read
  // the stored expense description, so re-label them here from the template.
  const templateNameById = new Map(
    templates.filter((t) => t.template_name).map((t) => [t.id, t.template_name] as const)
  );
  items = items.map((i) => {
    const name = i.recurringTemplateId ? templateNameById.get(i.recurringTemplateId) : undefined;
    return name ? { ...i, label: name } : i;
  });

  const projectOptions: Option[] = ((projectsResult.data ?? []) as Row[])
    .map((r) => {
      const id = getString(r, "id") ?? "";
      const name = getString(r, "name") ?? "";
      const customer = getString(r, "customer_name");
      return { id, label: customer ? `${name} (${customer})` : name };
    })
    .filter((o) => o.id && o.label);

  const propertyOptions: Option[] = ((propertiesResult.data ?? []) as Row[])
    .filter((r) => r.is_active !== false)
    .map((r) => ({
      id: getString(r, "id") ?? "",
      label: propertyDisplayName({ name: getString(r, "name"), address: getString(r, "address") ?? "" }),
    }))
    .filter((o) => o.id && o.label);

  const orderOptions: Option[] = ((ordersResult.data ?? []) as Row[])
    .map((r) => {
      const id = getString(r, "order_id") ?? "";
      const customer = getString(r, "customer_name") ?? "";
      const date = getString(r, "order_date") ?? "";
      return { id, label: customer ? `${customer} (${date})` : id };
    })
    .filter((o) => o.id);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-5">
        {error ? (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : (
          <PaymentsHubClient
            items={items}
            todayIso={todayIso}
            templates={templates}
            projects={projectOptions}
            properties={propertyOptions}
            orders={orderOptions}
            accounts={accounts}
            expenseMissingSchema={expenseMissingSchema}
          />
        )}
      </div>
    </AppShell>
  );
}
