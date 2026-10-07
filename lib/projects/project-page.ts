import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_SELECT } from "@/lib/payments";
import { emptyProjectOwed, loadProjectOwed, type ProjectOwed } from "@/lib/projects/owed";
import { getCurrentVatRate } from "@/lib/settings/vat";

// What a project's page shows of the project itself — its details, money,
// tasks and movements (expenses, worker shifts, payslips, payments) — read
// the same way wherever it's read. The rest of the page (its documents and
// every row's attachments, Morning documents, "entered by" from the change
// log, the history) only the server can read:
// app/(app)/projects/[id]/loadProjectPageExtras.ts, sent after the page.

type Row = Record<string, unknown>;
type ReadError = { message: string } | null;

export type ProjectMonthlySalaryRow = {
  payslip_id: string;
  user_id: string | null;
  period_month: string | null;
  earned_amount: number | string | null;
  paid_amount: number | string | null;
  owed_amount: number | string | null;
  payment_status: string | null;
  is_billable_to_customer: boolean | null;
  bill_to_customer_amount: number | string | null;
};

export type ProjectPageCore = {
  /** The project this is for. */
  filters: { id: string };
  currentVatRate: number;
  /** project_dashboard_view's row: overview, money totals and task counts in one. */
  dashboardRow: Row | null;
  /** The projects row's own fields (notes, the move's route and load, terms, VAT, branch). */
  details: Row | null;
  workerBalance: Row | null;
  /** The project's tasks (task_overview_view), first 200 by due date. */
  projectTasks: Row[];
  /** Everyone, for the tasks and expense dialogs (first 200 by name). */
  assignableUsers: Row[];
  /** The picker's first customers. */
  customers: Row[];
  projectExpenses: Row[];
  /** The expenses project_expenses points at. */
  expenses: Row[];
  salaryAgreements: Row[];
  /** Payslip costs attributed to this project. */
  monthlySalaryItems: ProjectMonthlySalaryRow[];
  /** The project's worker shifts, newest first (first 100). */
  attendanceSessions: Row[];
  /** Each shift's effective payment (session_effective_payment_view), by shift id. */
  sessionDebtById: Record<string, Row>;
  /** `session:<id>` / `payslip:<id>` → the accounts of the worker payments that settled it. */
  wageAccountIdsBySource: Record<string, string[]>;
  /** Newest first (first 100). */
  payments: Row[];
  /** Who recorded each payment / expense: the name behind each value stored. */
  paymentRecordedByNameByValue: Record<string, string>;
  expenseRecordedByNameByValue: Record<string, string>;
  /** Recurring template id → its name, and → who set the rule up. */
  recurringTemplateNames: Record<string, string>;
  recurringTemplateAuthors: Record<string, string>;
  customerRow: Row | null;
  branchRow: Row | null;
  accountNameById: Record<string, string>;
  owed: ProjectOwed;
  /** Each read's failure, shown on the page. */
  errors: {
    overview: string | null;
    projectExpenses: string | null;
    expenses: string | null;
    sessions: string | null;
    payments: string | null;
  };
};

const OVERVIEW_COLUMNS =
  "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,expenses_billed_separately,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at";

function getString(row: Row | null | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" && value ? value : null;
}

/** The distinct non-empty strings among `rows[key]`. */
function idsOf(rows: Row[] | null | undefined, key = "id"): string[] {
  return Array.from(new Set((rows ?? []).map((row) => getString(row, key)).filter((v): v is string => Boolean(v))));
}

function userDisplayName(row: Row) {
  const fullName = getString(row, "full_name");
  if (fullName && fullName.trim()) return fullName.trim();
  const email = getString(row, "email");
  if (email && email.trim()) return email.trim();
  return "משתמש";
}

/** Names behind values that are either someone's id or their login id. */
async function namesForValues(supabase: SupabaseClient, values: string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  if (values.length === 0) return names;
  const [byId, byAuthId] = await Promise.all([
    supabase.from("users").select("id,auth_user_id,full_name,email").in("id", values),
    supabase.from("users").select("id,auth_user_id,full_name,email").in("auth_user_id", values),
  ]);
  for (const row of [...((byId.data ?? []) as Row[]), ...((byAuthId.data ?? []) as Row[])]) {
    const displayName = userDisplayName(row);
    const userId = getString(row, "id");
    const authUserId = getString(row, "auth_user_id");
    if (userId) names[userId] = displayName;
    if (authUserId) names[authUserId] = displayName;
  }
  return names;
}

/**
 * A wage (session / payslip) has no account of its own — the money left
 * through whichever worker payment(s) settled it. Source id → the distinct
 * account ids of those payments. Silent on error (e.g. a role that can't read
 * payroll): the row just shows no account.
 */
async function loadWageAccountIds(
  supabase: SupabaseClient,
  column: "attendance_session_id" | "payslip_id",
  sourceIds: string[]
): Promise<Map<string, string[]>> {
  const bySource = new Map<string, string[]>();
  if (sourceIds.length === 0) return bySource;
  const { data, error } = await supabase
    .from("worker_payment_allocations")
    .select(`${column},worker_payments(account_id)`)
    .in(column, sourceIds);
  if (error) return bySource;
  for (const row of (data ?? []) as Row[]) {
    const sourceId = row[column];
    const payment = Array.isArray(row.worker_payments) ? row.worker_payments[0] : row.worker_payments;
    const accountId = (payment as { account_id?: unknown } | null)?.account_id;
    if (typeof sourceId !== "string" || typeof accountId !== "string" || !accountId) continue;
    const list = bySource.get(sourceId) ?? [];
    if (!list.includes(accountId)) list.push(accountId);
    bySource.set(sourceId, list);
  }
  return bySource;
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  return code === "42703" && typeof message === "string" && message.toLowerCase().includes(columnName.toLowerCase());
}

export type ProjectPageReads = {
  core: Promise<ProjectPageCore>;
  /** The ids the server-only parts need, each as soon as it's known. */
  expenseIds: Promise<string[]>;
  sessionIds: Promise<string[]>;
  paymentIds: Promise<string[]>;
};

/**
 * Every read goes out at once, each as soon as what it needs is in — the
 * longest chain is what the page waits for (the expenses: the project's
 * expense links, then the expenses, then who entered them).
 */
export function startProjectPageReads(supabase: SupabaseClient, id: string): ProjectPageReads {
  const vatRead = getCurrentVatRate(supabase);
  // The overview, the money totals and the task counts in ONE read:
  // project_dashboard_view is project_overview_view joined with
  // project_financials_view and project_task_progress_view.
  const dashboardRead = Promise.resolve(
    supabase
      .from("project_dashboard_view")
      .select(`${OVERVIEW_COLUMNS},total_expenses,expenses_billed,customer_total_price,gross_profit,total_tasks,completed_tasks,open_tasks`)
      .eq("id", id)
      .maybeSingle()
  );
  const detailsRead = Promise.resolve(
    supabase
      .from("projects")
      .select(
        "id,notes,items_to_move,origin_address,origin_floor,origin_has_elevator,destination_address,destination_floor,destination_has_elevator,payment_terms,due_date,price_includes_vat,no_charge,vat_rate,branch_id"
      )
      .eq("id", id)
      .maybeSingle()
  );
  const workerBalanceRead = Promise.resolve(
    supabase.from("project_worker_balance_view").select("project_id,earned_amount,paid_amount,owed_amount").eq("project_id", id).maybeSingle()
  );
  const tasksRead = Promise.resolve(
    supabase
      .from("task_overview_view")
      .select("task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at,is_overdue")
      .eq("project_id", id)
      .order("due_date", { ascending: true })
      .order("task_id")
      .range(0, 199)
  );
  const usersRead = Promise.resolve(
    supabase
      .from("users")
      .select("id,full_name,email,role,active,payroll_worker_type,pay_tracking_mode")
      .order("full_name", { ascending: true })
      .order("id")
      .range(0, 199)
  );
  // Straight from customers: customer_overview_view would total every
  // customer's orders, projects and payments just to fill a picker.
  const customersRead = Promise.resolve(
    supabase.from("customers").select("id,name,name_for_invoice").order("name", { ascending: true }).order("id").range(0, 199)
  );
  const projectExpensesRead = Promise.resolve(
    supabase
      .from("project_expenses")
      .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
      .eq("project_id", id)
      .order("id", { ascending: false })
      .range(0, 99)
  );
  const sessionsRead = Promise.resolve(
    supabase
      .from("attendance_sessions")
      .select(
        "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
      )
      .eq("project_id", id)
      .order("clock_in", { ascending: false })
      .order("id")
      .range(0, 99)
  );
  const paymentsRead = Promise.resolve(
    supabase
      .from("payments")
      .select(PAYMENT_SELECT)
      .eq("project_id", id)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(0, 99)
  );
  // The payslip costs attributed to THIS project via the worker's salary
  // agreement (business_domain=פרויקטים + project_id) — read-only lines in the
  // project's expenses; the totals come from project_financials_view.
  const payslipsRead = Promise.resolve(
    supabase
      .from("worker_debt_items_view")
      .select("source_id,user_id,period_month,earned_amount,paid_amount,owed_amount,payment_status,is_billable_to_customer,bill_to_customer_amount")
      .eq("source_type", "payslip")
      .eq("project_id", id)
      .order("period_month", { ascending: false })
      .order("source_id")
  );
  // Account names for the תנועות rows — inactive ones too, since an old row
  // can still point at an account that's since been closed. Named as
  // loadAccounts names them (lib/accounts.ts); none when they can't be read.
  const accountsRead = Promise.resolve(supabase.from("accounts").select("id,name")).then(({ data, error }) => {
    const names: Record<string, string> = {};
    if (error) return names;
    for (const row of (data ?? []) as Row[]) {
      const accountId = getString(row, "id");
      if (accountId) names[accountId] = getString(row, "name")?.trim() || "חשבון";
    }
    return names;
  });
  // "הוצאות שלא שולמו" — the project's unpaid expenses (the wages part comes
  // from the worker balance). A failed read shows nothing owed rather than
  // failing the page.
  const owedRead = loadProjectOwed(supabase, [id], { includeWorkers: false })
    .then((byProject) => byProject.get(id) ?? emptyProjectOwed())
    .catch(() => emptyProjectOwed());

  const expenseIds = projectExpensesRead.then(({ data }) => idsOf(data as Row[] | null, "expense_id"));
  const sessionIds = sessionsRead.then(({ data }) => idsOf(data as Row[] | null));
  const paymentIds = paymentsRead.then(({ data }) => idsOf(data as Row[] | null));

  const salaryRead = usersRead.then(async ({ data: users }) => {
    const userIds = idsOf(users as Row[] | null);
    if (userIds.length === 0) return [] as Row[];
    const { data } = await supabase
      .from("salary_agreements")
      // due_day_of_next_month dates a payslip line in the ledger: the salary
      // is paid on that day of the month AFTER the one it covers.
      .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month")
      .in("user_id", userIds)
      .order("valid_from", { ascending: false })
      .order("id");
    return (data ?? []) as Row[];
  });
  const expensesRead = expenseIds.then(async (ids): Promise<{ rows: Row[]; error: ReadError }> => {
    if (ids.length === 0) return { rows: [], error: null };
    const primary = await supabase
      .from("expenses")
      .select(
        "id,expense_date,amount,payment_method,payment_status,paid_amount,category,description,business_domain,notes,account_id,recorded_by,created_at,updated_at,recurring_expense_template_id"
      )
      .order("expense_date", { ascending: false })
      .order("id")
      .in("id", ids);
    if (primary.error && isMissingColumnError(primary.error, "payment_method")) {
      const fallback = await supabase
        .from("expenses")
        .select("id,expense_date,amount,payment_status,paid_amount,category,description,business_domain,notes,recorded_by,created_at,updated_at,recurring_expense_template_id")
        .order("expense_date", { ascending: false })
        .order("id")
        .in("id", ids);
      return {
        rows: ((fallback.data ?? []) as Row[]).map((row) => ({ ...row, payment_method: null })),
        error: fallback.error ? { message: fallback.error.message } : null,
      };
    }
    return { rows: (primary.data ?? []) as Row[], error: primary.error ? { message: primary.error.message } : null };
  });
  const expenseNamesRead = expensesRead.then(({ rows }) => namesForValues(supabase, idsOf(rows, "recorded_by")));
  // A row generated from a recurring template reads by the template's name —
  // the same label the ledger and the payments calendar use.
  const templatesRead = expensesRead.then(async ({ rows }) => {
    const templateIds = idsOf(rows, "recurring_expense_template_id");
    if (templateIds.length === 0) return [] as Row[];
    const { data } = await supabase.from("recurring_expense_templates").select("id,template_name,created_by").in("id", templateIds);
    return (data ?? []) as Row[];
  });
  const payslipAccountsRead = payslipsRead.then(({ data }) =>
    loadWageAccountIds(supabase, "payslip_id", idsOf(data as Row[] | null, "source_id"))
  );
  // Each shift's paid status comes from ONE source of truth —
  // session_effective_payment_view — which folds in the rule that a paid
  // monthly payslip covers all of that month's sessions. Until that view
  // exists, the raw session debt rows.
  const sessionDebtRead = sessionIds.then(async (ids): Promise<Row[]> => {
    if (ids.length === 0) return [];
    const effective = await supabase
      .from("session_effective_payment_view")
      .select("session_id,paid_amount,owed_amount,payment_status,last_payment_date,due_date")
      .in("session_id", ids);
    if (!effective.error) return (effective.data ?? []) as Row[];
    const fallback = await supabase
      .from("worker_debt_items_view")
      .select("source_id,paid_amount,owed_amount,payment_status,last_payment_date,due_date")
      .eq("source_type", "session")
      .in("source_id", ids);
    return ((fallback.data ?? []) as Row[]).map((row) => ({ ...row, session_id: row.source_id }));
  });
  const sessionAccountsRead = sessionIds.then((ids) => loadWageAccountIds(supabase, "attendance_session_id", ids));
  const paymentNamesRead = paymentsRead.then(({ data }) => namesForValues(supabase, idsOf(data as Row[] | null, "recorded_by")));
  // Straight from customers (not customer_overview_view, which totals the
  // customer's whole history to answer a contact lookup).
  const customerRead = dashboardRead.then(async ({ data }) => {
    const customerId = getString(data as Row | null, "customer_id");
    if (!customerId) return null;
    const { data: row } = await supabase.from("customers").select("phone,email,address,name_for_invoice").eq("id", customerId).maybeSingle();
    return (row ?? null) as Row | null;
  });
  const branchRead = detailsRead.then(async ({ data }) => {
    const branchId = getString(data as Row | null, "branch_id");
    if (!branchId) return null;
    const { data: row } = await supabase.from("customer_branches").select("id,name,address,phone").eq("id", branchId).maybeSingle();
    return (row ?? null) as Row | null;
  });

  const core = (async (): Promise<ProjectPageCore> => {
    const [
      currentVatRate,
      dashboard,
      details,
      workerBalance,
      tasks,
      users,
      customers,
      projectExpenses,
      sessions,
      payments,
      payslips,
      accountNameById,
      owed,
      salaryAgreements,
      expenses,
      expenseRecordedByNameByValue,
      templates,
      payslipAccountIds,
      sessionDebtRows,
      sessionAccountIds,
      paymentRecordedByNameByValue,
      customerRow,
      branchRow,
    ] = await Promise.all([
      vatRead,
      dashboardRead,
      detailsRead,
      workerBalanceRead,
      tasksRead,
      usersRead,
      customersRead,
      projectExpensesRead,
      sessionsRead,
      paymentsRead,
      payslipsRead,
      accountsRead,
      owedRead,
      salaryRead,
      expensesRead,
      expenseNamesRead,
      templatesRead,
      payslipAccountsRead,
      sessionDebtRead,
      sessionAccountsRead,
      paymentNamesRead,
      customerRead,
      branchRead,
    ]);

    const recurringTemplateNames: Record<string, string> = {};
    // Who set each rule up — the generator stamps them on every bill it
    // creates, which is how a generated bill is told from one a person entered.
    const recurringTemplateAuthors: Record<string, string> = {};
    for (const row of templates) {
      const templateId = getString(row, "id");
      const name = getString(row, "template_name")?.trim();
      if (templateId && name) recurringTemplateNames[templateId] = name;
      const author = getString(row, "created_by");
      if (templateId && author) recurringTemplateAuthors[templateId] = author;
    }

    const sessionDebtById: Record<string, Row> = {};
    for (const row of sessionDebtRows) {
      const sessionId = getString(row, "session_id");
      if (sessionId) sessionDebtById[sessionId] = row;
    }

    const monthlySalaryItems: ProjectMonthlySalaryRow[] = ((payslips.data ?? []) as Row[]).map((row) => ({
      payslip_id: typeof row.source_id === "string" ? row.source_id : "",
      user_id: typeof row.user_id === "string" ? row.user_id : null,
      period_month: typeof row.period_month === "string" ? row.period_month : null,
      earned_amount: (row.earned_amount as number | string | null) ?? null,
      paid_amount: (row.paid_amount as number | string | null) ?? null,
      owed_amount: (row.owed_amount as number | string | null) ?? null,
      payment_status: typeof row.payment_status === "string" ? row.payment_status : null,
      is_billable_to_customer: (row.is_billable_to_customer as boolean | null) ?? null,
      bill_to_customer_amount: (row.bill_to_customer_amount as number | string | null) ?? null,
    }));

    return {
      filters: { id },
      currentVatRate,
      dashboardRow: (dashboard.data ?? null) as Row | null,
      details: (details.data ?? null) as Row | null,
      workerBalance: (workerBalance.data ?? null) as Row | null,
      projectTasks: (tasks.data ?? []) as Row[],
      assignableUsers: (users.data ?? []) as Row[],
      customers: (customers.data ?? []) as Row[],
      projectExpenses: (projectExpenses.data ?? []) as Row[],
      expenses: expenses.rows,
      salaryAgreements,
      monthlySalaryItems,
      attendanceSessions: (sessions.data ?? []) as Row[],
      sessionDebtById,
      wageAccountIdsBySource: {
        ...Object.fromEntries([...sessionAccountIds].map(([sessionId, ids]) => [`session:${sessionId}`, ids])),
        ...Object.fromEntries([...payslipAccountIds].map(([payslipId, ids]) => [`payslip:${payslipId}`, ids])),
      },
      payments: (payments.data ?? []) as Row[],
      paymentRecordedByNameByValue,
      expenseRecordedByNameByValue,
      recurringTemplateNames,
      recurringTemplateAuthors,
      customerRow,
      branchRow,
      accountNameById,
      owed,
      errors: {
        overview: dashboard.error?.message ?? null,
        projectExpenses: projectExpenses.error?.message ?? null,
        expenses: expenses.error?.message ?? null,
        sessions: sessions.error?.message ?? null,
        payments: payments.error?.message ?? null,
      },
    };
  })();

  return { core, expenseIds, sessionIds, paymentIds };
}

/**
 * Only the ids the server-only parts need (loadProjectPageExtras.ts) — the
 * same rows the page's own reads find — for a page drawn from the device.
 */
export function startProjectPageIdReads(
  supabase: SupabaseClient,
  id: string
): Pick<ProjectPageReads, "expenseIds" | "sessionIds" | "paymentIds"> {
  return {
    expenseIds: Promise.resolve(
      supabase.from("project_expenses").select("id,expense_id").eq("project_id", id).order("id", { ascending: false }).range(0, 99)
    ).then(({ data }) => idsOf(data as Row[] | null, "expense_id")),
    sessionIds: Promise.resolve(
      supabase
        .from("attendance_sessions")
        .select("id")
        .eq("project_id", id)
        .order("clock_in", { ascending: false })
        .order("id")
        .range(0, 99)
    ).then(({ data }) => idsOf(data as Row[] | null)),
    paymentIds: Promise.resolve(
      supabase
        .from("payments")
        .select("id")
        .eq("project_id", id)
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(0, 99)
    ).then(({ data }) => idsOf(data as Row[] | null)),
  };
}

/** The project's page core (see startProjectPageReads). */
export function loadProjectPageCore(supabase: SupabaseClient, id: string): Promise<ProjectPageCore> {
  return startProjectPageReads(supabase, id).core;
}
