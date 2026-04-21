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
};

export type AlertsResult = {
  alerts: AlertItem[];
  errors: {
    dashboard: string | null;
    invoices: string | null;
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

export async function getAlertsData(supabase: SupabaseClient): Promise<AlertsResult> {
  const [
    { data: dashboardRow, error: dashboardError },
    { data: invoiceRows, error: invoiceError },
  ] = await Promise.all([
    supabase
      .from("operations_dashboard_view")
      .select("low_inventory_count,overdue_tasks_count")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select("id,payment_status,status,balance_due,amount_due,open_amount,remaining_amount")
      .order("created_at", { ascending: false })
      .range(0, 199),
  ]);

  const invoiceSourceMissing =
    invoiceError?.message?.includes("Could not find the table 'public.invoices'") ?? false;

  const unpaidInvoices = invoiceSourceMissing
    ? []
    : ((invoiceRows ?? []) as Row[]).filter((row) => isInvoiceUnpaid(row));

  const lowInventoryCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "low_inventory_count") ?? 0;
  const overdueTasksCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "overdue_tasks_count") ?? 0;

  return {
    alerts: [
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
      },
      {
        id: "low-inventory",
        title: "מלאי נמוך",
        description:
          lowInventoryCount > 0 ? `יש ${lowInventoryCount} פריטים מתחת לסף` : "המלאי תקין",
        href: "/inventory",
        count: lowInventoryCount,
        severity: lowInventoryCount > 0 ? "warning" : "info",
      },
      {
        id: "overdue-tasks",
        title: "משימות באיחור",
        description:
          overdueTasksCount > 0 ? `יש ${overdueTasksCount} משימות לטיפול` : "אין משימות באיחור",
        href: "/tasks",
        count: overdueTasksCount,
        severity: overdueTasksCount > 0 ? "danger" : "info",
      },
    ],
    errors: {
      dashboard: dashboardError?.message ?? null,
      invoices: invoiceSourceMissing ? null : invoiceError?.message ?? null,
    },
  };
}
