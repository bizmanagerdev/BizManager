import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPaymentCalendarItems, type PaymentCalendarItem } from "@/lib/payables";
import { loadFinancialEntries } from "@/lib/financial";
import { addMonthsToIso } from "@/lib/financial/utils";
import { loadIncomeCalendarItems } from "@/lib/receivables-load";
import { loadAccounts, type Account } from "@/lib/accounts";
import { propertyDisplayName } from "@/lib/properties";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import type { IncomeOptions } from "@/app/(app)/financial/payments-calendar/calendar.helpers";
import { isForeignCurrency, shekelsToday, type TodayFxRates } from "@/lib/fx/currencies";
import { loadTodayFxRates } from "@/lib/fx/rates";
import { israelDateKey } from "@/lib/timezone";

// "צפי תזרים" — the payments calendar (/financial/payments-calendar): what the
// page reads, in one place. The server's page runs it, the device runs the same
// code on its own copy (lib/powersync/dashboard-local.ts, card
// "paymentsCalendar"; owner, 2026-10-29: "yes go ahead with 1-3"), and the
// daily check runs it on the server's data to compare the two. The recurring
// bills are made apart from it (the nightly job, and after the page is sent).

type Row = Record<string, unknown>;
type Option = { id: string; label: string };

/** Everything PaymentsHubClient draws. */
export type PaymentsCalendarView = {
  items: PaymentCalendarItem[];
  todayIso: string;
  templates: RecurringExpenseTemplateItem[];
  projects: Option[];
  properties: Option[];
  orders: Option[];
  accounts: Account[];
  incomeOptions: IncomeOptions;
  expenseMissingSchema: boolean;
  /** The money scan failed: the page says so instead of drawing an empty board. */
  error: string | null;
};

function getString(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  return typeof v === "string" ? v : null;
}
function getNumber(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
// An order's day, for its pickers' labels — order_date is a timestamp, which
// the server and the device copy each write their own way.
function orderDay(row: Row) {
  return (getString(row, "order_date") ?? "").slice(0, 10);
}
function looksLikeMissingSchema(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache");
}

/** The payments calendar's whole page, read from `supabase` (the server's, or the device's copy). */
export async function loadPaymentsCalendarView(supabase: SupabaseClient): Promise<PaymentsCalendarView> {
  // The window, by Israel's calendar — the same on the server (UTC) and on a
  // phone, so the daily check compares like with like.
  const today = israelDateKey();
  // From 13 months back; forecasts reach a year ahead (a rent schedule, any
  // settlement date the clearing company could hand us).
  const from = addMonthsToIso(today, -13);
  const horizon = addMonthsToIso(today, 12);

  // ── Recurring templates + source lookups (the קבועות tab and the expense
  //    dialog's domain-link pickers) — none depend on the ledger, so they load
  //    alongside it. Each list ends its order on the id: rows that tie come in
  //    the same order every time, on the server and on the device.
  const lookupsPromise = Promise.all([
    supabase
      .from("recurring_expense_templates")
      .select("id,template_name,category,amount,currency,is_variable_amount,auto_paid,reminder_work_days_before,description_template,notes_template,business_domain,project_id,order_id,property_id,account_id,included_in_base_price,billed_to_customer,project_expense_notes_template,frequency,interval_months,create_day_of_month,expense_day_of_month,create_month_of_year,expense_month_of_year,start_date,end_date,is_active")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    // project_overview_view has project_dashboard_view's rows without the
    // financial and task totals these options never read.
    supabase
      .from("project_overview_view")
      .select("id,name,customer_name")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(0, 999),
    supabase
      .from("properties")
      .select("id,name,address,is_active")
      .order("address", { ascending: true })
      .order("id", { ascending: true })
      .range(0, 999),
    supabase
      .from("order_overview_view")
      .select("order_id,customer_name,order_date")
      .order("order_date", { ascending: false })
      .order("order_id", { ascending: true })
      .range(0, 499),
    loadAccounts(supabase).catch(() => [] as Account[]),
    // A bill in US$ / C$ shows its shekels at today's rate.
    loadTodayFxRates(supabase).catch(() => ({}) as TodayFxRates),
  ]);
  // Awaited below. This only stops a failure that lands meanwhile from being
  // reported as unhandled before then.
  lookupsPromise.catch(() => {});

  let items: PaymentCalendarItem[] = [];
  let todayIso = today;
  let error: string | null = null;
  try {
    // One ledger read feeds both directions — the outgoing loader adds its
    // forecasts (bills, wages, card charges), the incoming one re-dates
    // receivables by their payment terms and drops bounced money.
    const { entries, referenceDate } = await loadFinancialEntries(supabase, { from });
    const [outgoing, incoming] = await Promise.all([
      loadPaymentCalendarItems(supabase, { preloaded: { entries, referenceDate } }),
      // Incoming is additive: if it fails, the board is still the board it was.
      loadIncomeCalendarItems(supabase, { entries, referenceDate, fromIso: from, toIso: horizon }).catch(() => [] as PaymentCalendarItem[]),
    ]);
    items = [...outgoing.items, ...incoming];
    todayIso = outgoing.todayIso;
  } catch (err) {
    error = (err as { message?: string })?.message ?? "שגיאה בטעינת התשלומים";
  }

  const [expResult, projectsResult, propertiesResult, ordersResult, accounts, fxRates] = await lookupsPromise;

  const expenseMissingSchema = Boolean(expResult.error?.message && looksLikeMissingSchema(expResult.error.message));

  const templates: RecurringExpenseTemplateItem[] = expenseMissingSchema
    ? []
    : ((expResult.data ?? []) as Row[]).map((r) => ({
        id: getString(r, "id") ?? "",
        template_name: getString(r, "template_name") ?? "",
        category: getString(r, "category") ?? "",
        amount: getNumber(r, "amount") ?? 0,
        currency: isForeignCurrency(r.currency) ? r.currency : "ILS",
        shekels_today: isForeignCurrency(r.currency) ? shekelsToday(getNumber(r, "amount") ?? 0, r.currency, fxRates) : null,
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

  // Every recurring calendar item (forecast OR already materialized) shows the
  // template NAME — not the free-text description/category — matching the
  // recurring-templates list. Forecasts already carry the name; paid items read
  // the stored expense description, so re-label them here from the template.
  const templateNameById = new Map(templates.filter((t) => t.template_name).map((t) => [t.id, t.template_name] as const));
  items = items.map((i) => {
    const name = i.recurringTemplateId ? templateNameById.get(i.recurringTemplateId) : undefined;
    return name ? { ...i, label: name } : i;
  });

  const projectRows = (projectsResult.data ?? []) as Row[];
  const propertyRows = ((propertiesResult.data ?? []) as Row[]).filter((r) => r.is_active !== false);
  const orderRows = (ordersResult.data ?? []) as Row[];

  const projects: Option[] = projectRows
    .map((r) => {
      const name = getString(r, "name") ?? "";
      const customer = getString(r, "customer_name");
      return { id: getString(r, "id") ?? "", label: customer ? `${name} (${customer})` : name };
    })
    .filter((o) => o.id && o.label);

  const properties: Option[] = propertyRows
    .map((r) => ({
      id: getString(r, "id") ?? "",
      label: propertyDisplayName({ name: getString(r, "name"), address: getString(r, "address") ?? "" }),
    }))
    .filter((o) => o.id && o.label);

  // The income dialog's pickers want more than {id,label}: a project shows its
  // customer, an order its date. Same three queries, read a second way.
  const incomeOptions: IncomeOptions = {
    projects: projectRows
      .map((r) => ({ id: getString(r, "id") ?? "", name: getString(r, "name") ?? "", customerName: getString(r, "customer_name") ?? "" }))
      .filter((o) => o.id && o.name),
    orders: orderRows
      .map((r) => ({
        id: getString(r, "order_id") ?? "",
        name: getString(r, "customer_name") || `הזמנה ${(getString(r, "order_id") ?? "").slice(0, 8)}`,
        subtitle: orderDay(r) || undefined,
      }))
      .filter((o) => o.id),
    properties: propertyRows
      .map((r) => ({
        id: getString(r, "id") ?? "",
        name: propertyDisplayName({ name: getString(r, "name"), address: getString(r, "address") ?? "" }),
      }))
      .filter((o) => o.id && o.name),
  };

  const orders: Option[] = orderRows
    .map((r) => {
      const id = getString(r, "order_id") ?? "";
      const customer = getString(r, "customer_name") ?? "";
      return { id, label: customer ? `${customer} (${orderDay(r)})` : id };
    })
    .filter((o) => o.id);

  return { items, todayIso, templates, projects, properties, orders, accounts, incomeOptions, expenseMissingSchema, error };
}
