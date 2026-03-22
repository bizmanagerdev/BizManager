import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type Row = Record<string, unknown>;

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

function getDateValue(row: Row | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function isTaskOpen(status: string | null) {
  const normalized = (status ?? "").toLowerCase();
  return !["done", "completed", "cancelled", "canceled"].includes(normalized);
}

function isTaskOverdue(row: Row, today: Date) {
  if (row.is_overdue === true) return true;
  const dueDate = getDateValue(row, ["due_date"]);
  if (!dueDate) return false;
  return isTaskOpen(getString(row, "status")) && dueDate.getTime() < today.getTime();
}

function isInvoiceUnpaid(row: Row, today: Date) {
  const paymentStatus = (getString(row, "payment_status") ?? "").toLowerCase();
  const status = (getString(row, "status") ?? "").toLowerCase();
  const balanceDue =
    getNumber(row, "balance_due") ??
    getNumber(row, "amount_due") ??
    getNumber(row, "open_amount") ??
    getNumber(row, "remaining_amount");

  if (balanceDue !== null) return balanceDue > 0;
  if (["unpaid", "partial", "overdue", "open", "pending"].includes(paymentStatus)) return true;
  if (["unpaid", "partial", "overdue", "open", "pending"].includes(status)) return true;

  const dueDate = getDateValue(row, ["due_date"]);
  const totalAmount =
    getNumber(row, "total_amount") ??
    getNumber(row, "invoice_total") ??
    getNumber(row, "amount_total");
  const paidAmount = getNumber(row, "paid_amount") ?? getNumber(row, "amount_paid");

  return Boolean(dueDate && dueDate < today && (totalAmount ?? 0) > (paidAmount ?? 0));
}

export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase } = access.value;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    { data: invoiceRows, error: invoiceError },
    { data: inventoryRows, error: inventoryError },
    { data: productRows, error: productError },
    { data: taskRows, error: taskError },
  ] = await Promise.all([
    supabase.from("invoices").select("*").limit(200),
    supabase.from("inventory").select("product_id,quantity_on_hand,quantity_reserved").limit(500),
    supabase.from("products").select("id,name,sku").limit(500),
    supabase
      .from("task_overview_view")
      .select("task_id,subject,status,due_date,project_name,assigned_user_name,is_overdue")
      .order("due_date", { ascending: true })
      .limit(200),
  ]);

  const invoiceSourceMissing =
    invoiceError?.message?.includes("Could not find the table 'public.invoices'") ?? false;

  const productsById = new Map<string, Row>();
  ((productRows ?? []) as Row[]).forEach((row) => {
    const id = getString(row, "id");
    if (id) productsById.set(id, row);
  });

  const lowInventory = ((inventoryRows ?? []) as Row[])
    .map((row) => {
      const productId = getString(row, "product_id") ?? "";
      const product = productsById.get(productId) ?? null;
      const onHand = getNumber(row, "quantity_on_hand") ?? 0;
      const reserved = getNumber(row, "quantity_reserved") ?? 0;
      return {
        productId,
        name: getString(product, "name") ?? getString(product, "sku") ?? "מוצר",
        available: onHand - reserved,
      };
    })
    .filter((row) => row.productId && row.available <= 5);

  const overdueTasks = ((taskRows ?? []) as Row[]).filter((row) => isTaskOverdue(row, today));
  const unpaidInvoices = invoiceSourceMissing
    ? []
    : ((invoiceRows ?? []) as Row[]).filter((row) => isInvoiceUnpaid(row, today));

  const alerts = [
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
        lowInventory.length > 0 ? `יש ${lowInventory.length} פריטים מתחת לסף` : "המלאי תקין",
      href: "/inventory",
      count: lowInventory.length,
      severity: lowInventory.length > 0 ? "warning" : "info",
    },
    {
      id: "overdue-tasks",
      title: "משימות באיחור",
      description:
        overdueTasks.length > 0 ? `יש ${overdueTasks.length} משימות לטיפול` : "אין משימות באיחור",
      href: "/tasks",
      count: overdueTasks.length,
      severity: overdueTasks.length > 0 ? "danger" : "info",
    },
  ];

  return NextResponse.json({
    alerts,
    totalCount: alerts.reduce((sum, alert) => sum + alert.count, 0),
    errors: {
      inventory: inventoryError?.message ?? null,
      products: productError?.message ?? null,
      tasks: taskError?.message ?? null,
      invoices: invoiceSourceMissing ? null : invoiceError?.message ?? null,
    },
  });
}
