import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export type AlertSeverity = "info" | "warning" | "danger";

export type AlertItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  count: number;
  severity: AlertSeverity;
  countsAsActiveAlert?: boolean;
};

export type AlertsResult = {
  alerts: AlertItem[];
  errors: {
    dashboard: string | null;
    invoices: string | null;
    payroll: string | null;
    projects: string | null;
  };
};

function getString(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getBoolean(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "boolean" ? value : null;
}

function isInvoiceUnpaid(row: Row) {
  const paymentStatus = (getString(row, "payment_status") ?? "").toLowerCase();
  const status = (getString(row, "status") ?? "").toLowerCase();
  const balanceDue =
    getNumber(row, "balance_due") ??
    getNumber(row, "amount_due") ??
    getNumber(row, "open_amount") ??
    getNumber(row, "remaining_amount");

  if (balanceDue !== null) return balanceDue > 0;
  return (
    ["unpaid", "partial", "overdue", "open", "pending"].includes(paymentStatus) ||
    ["unpaid", "partial", "overdue", "open", "pending"].includes(status)
  );
}

function nextMonthDueDateIso(periodEndDateIso: string) {
  const parts = periodEndDateIso.split("-");
  if (parts.length < 2) return "";
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return "";
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-10`;
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  return (
    code === "42703" &&
    typeof message === "string" &&
    message.toLowerCase().includes(`column worker_debt_items_view.${columnName}`.toLowerCase())
  );
}

function currencyFormatterHeIl() {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
}

export async function getAlertsData(
  supabase: SupabaseClient,
  options?: { viewerRole?: string | null }
): Promise<AlertsResult> {
  const viewerRole = options?.viewerRole ?? null;
  const [
    { data: dashboardRow, error: dashboardError },
    { data: invoiceRows, error: invoiceError },
    payrollDebtResultRaw,
    inventoryProductsResult,
    inventoryRowsResult,
  ] = await Promise.all([
    supabase
      .from("operations_dashboard_view")
      .select("active_projects_count,low_inventory_count,overdue_tasks_count")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select("id,payment_status,status,balance_due,amount_due,open_amount,remaining_amount")
      .order("created_at", { ascending: false })
      .range(0, 199),
    viewerRole === "admin"
      ? supabase
          .from("worker_debt_items_view")
          .select("user_id,source_date,due_date,owed_amount,source_type")
          .eq("source_type", "payslip")
          .gt("owed_amount", 0.009)
          .range(0, 1999)
      : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: { message?: string } | null }),
    supabase.from("products").select("id,active,low_stock_threshold"),
    supabase.from("inventory").select("product_id,quantity_on_hand,quantity_reserved"),
  ]);

  let payrollDebtResult = payrollDebtResultRaw;

  if (payrollDebtResult.error && isMissingColumnError(payrollDebtResult.error, "due_date")) {
    payrollDebtResult = await supabase
      .from("worker_debt_items_view")
      .select("user_id,source_date,owed_amount,source_type")
      .eq("source_type", "payslip")
      .gt("owed_amount", 0.009)
      .range(0, 1999);
  }

  const invoiceSourceMissing =
    invoiceError?.message?.includes("Could not find the table 'public.invoices'") ?? false;

  const unpaidInvoices = invoiceSourceMissing
    ? []
    : ((invoiceRows ?? []) as Row[]).filter((row) => isInvoiceUnpaid(row));

  const overdueTasksCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "overdue_tasks_count") ?? 0;

  const inventoryProductsErrorCode = (inventoryProductsResult.error as { code?: string } | null)?.code ?? null;
  const inventoryProducts =
    inventoryProductsErrorCode === "42703"
      ? (
          await supabase.from("products").select("id,active")
        )
      : inventoryProductsResult;

  const inventoryByProductId = new Map<string, { onHand: number; reserved: number }>();
  ((inventoryRowsResult.data ?? []) as Row[]).forEach((row) => {
    const productId = getString(row, "product_id");
    if (!productId) return;
    inventoryByProductId.set(productId, {
      onHand: getNumber(row, "quantity_on_hand") ?? 0,
      reserved: getNumber(row, "quantity_reserved") ?? 0,
    });
  });

  const lowInventoryCount = ((inventoryProducts.data ?? []) as Row[]).reduce((count, row) => {
    const id = getString(row, "id");
    if (!id) return count;
    if (getBoolean(row, "active") === false) return count;

    const threshold = getNumber(row, "low_stock_threshold") ?? 5;
    const inventory = inventoryByProductId.get(id);
    const available = (inventory?.onHand ?? 0) - (inventory?.reserved ?? 0);
    return available <= threshold ? count + 1 : count;
  }, 0);

  const activeProjectsCount =
    getNumber((dashboardRow as Row | null | undefined) ?? undefined, "active_projects_count") ?? 0;

  const payrollDebtRows = (payrollDebtResult.data ?? []) as Array<{
    user_id?: string | null;
    source_date?: string | null;
    due_date?: string | null;
    owed_amount?: number | string | null;
  }>;
  const todayIso = new Date().toISOString().slice(0, 10);
  const overduePayslipDebtRows = payrollDebtRows.filter((row) => {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    const sourceDate = typeof row.source_date === "string" ? row.source_date : "";
    const dueDate = typeof row.due_date === "string" ? row.due_date : "";
    const owedAmount = typeof row.owed_amount === "number" || typeof row.owed_amount === "string" ? Number(row.owed_amount) : 0;
    if (!userId || !sourceDate || !Number.isFinite(owedAmount) || owedAmount <= 0.009) return false;
    const dueIso = dueDate || nextMonthDueDateIso(sourceDate);
    return Boolean(dueIso) && todayIso > dueIso;
  });
  const overdueUserIds = new Set(overduePayslipDebtRows.map((row) => (typeof row.user_id === "string" ? row.user_id : "")).filter(Boolean));
  const overduePayslipCount = overduePayslipDebtRows.length;
  const overdueWorkersCount = overdueUserIds.size;
  const overdueOwedTotal = overduePayslipDebtRows.reduce((sum, row) => {
    const owedAmount = typeof row.owed_amount === "number" || typeof row.owed_amount === "string" ? Number(row.owed_amount) : 0;
    return sum + (Number.isFinite(owedAmount) ? owedAmount : 0);
  }, 0);

  const moneyOwedToWorkersAlert: AlertItem | null =
    viewerRole === "admin"
      ? {
          id: "worker-wages-due",
          title: "שכר עובדים לתשלום",
          description:
            overduePayslipCount > 0
              ? `יש ${overdueWorkersCount} עובדים עם תלוש שכר שלא שולם בזמן (סה\"כ ${currencyFormatterHeIl().format(overdueOwedTotal)}).`
              : "אין תלושי שכר באיחור לתשלום",
          href: "/payroll",
          count: overduePayslipCount,
          severity: overduePayslipCount > 0 ? "danger" : "info",
          countsAsActiveAlert: true,
        }
      : null;

  return {
    alerts: [
      {
        id: "active-projects",
        title: "פרויקטים פעילים",
        description: activeProjectsCount > 0 ? `יש ${activeProjectsCount} פרויקטים פעילים` : "אין פרויקטים פעילים",
        href: "/projects",
        count: activeProjectsCount,
        severity: "info",
        countsAsActiveAlert: false,
      },
      ...(moneyOwedToWorkersAlert ? [moneyOwedToWorkersAlert] : []),
      {
        id: "unpaid-invoices",
        title: "חשבוניות לא משולמות",
        description: invoiceSourceMissing
          ? "טבלת חשבוניות לא הוגדרה עדיין"
          : unpaidInvoices.length > 0
            ? `יש ${unpaidInvoices.length} חשבוניות פתוחות`
            : "אין חשבוניות פתוחות",
        href: "/invoices",
        count: unpaidInvoices.length,
        severity: invoiceSourceMissing ? "info" : unpaidInvoices.length > 0 ? "danger" : "info",
        countsAsActiveAlert: !invoiceSourceMissing,
      },
      {
        id: "low-inventory",
        title: "מלאי נמוך",
        description:
          lowInventoryCount > 0 ? `יש ${lowInventoryCount} פריטים מתחת לסף` : "המלאי תקין",
        href: "/inventory",
        count: lowInventoryCount,
        severity: lowInventoryCount > 0 ? "warning" : "info",
        countsAsActiveAlert: true,
      },
      {
        id: "overdue-tasks",
        title: "משימות באיחור",
        description:
          overdueTasksCount > 0 ? `יש ${overdueTasksCount} משימות לטיפול` : "אין משימות באיחור",
        href: "/tasks",
        count: overdueTasksCount,
        severity: overdueTasksCount > 0 ? "danger" : "info",
        countsAsActiveAlert: true,
      },
    ],
    errors: {
      dashboard:
        dashboardError?.message ??
        inventoryRowsResult.error?.message ??
        inventoryProducts.error?.message ??
        null,
      invoices: invoiceSourceMissing ? null : invoiceError?.message ?? null,
      payroll: viewerRole === "admin" ? payrollDebtResult.error?.message ?? null : null,
      projects: null,
    },
  };
}
