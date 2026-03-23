import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { AdaptiveGrid, PageStack, ResponsiveMetricValue } from "@/components/layout/page-layout";
import { requireProfile } from "@/lib/auth/requireProfile";
import DashboardActions from "@/app/dashboard/DashboardActions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Row = Record<string, unknown>;

export const revalidate = 60;

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("he-IL");

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

function firstString(row: Row | null | undefined, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value && value.trim()) return value;
  }
  return fallback;
}

function firstNumber(row: Row | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = getNumber(row, key);
    if (value !== null) return value;
  }
  return null;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return currencyFormatter.format(value);
}

function formatCount(value: number) {
  return numberFormatter.format(value);
}

function formatDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "0%" : "חדש";
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function isProjectActive(status: string | null) {
  const normalized = (status ?? "").toLowerCase();
  return !["done", "completed", "cancelled", "canceled", "archived", "closed"].includes(
    normalized
  );
}

function isTaskOpen(status: string | null) {
  const normalized = (status ?? "").toLowerCase();
  return !["done", "completed", "cancelled", "canceled"].includes(normalized);
}

function isTaskOverdue(row: Row, today: Date) {
  if (row.is_overdue === true) return true;
  const dueDate = getDateValue(row, ["due_date"]);
  if (!dueDate) return false;
  const status = getString(row, "status");
  return isTaskOpen(status) && dueDate.getTime() < today.getTime();
}

function isInvoiceUnpaid(row: Row, today: Date) {
  const paymentStatus = (getString(row, "payment_status") ?? "").toLowerCase();
  const status = (getString(row, "status") ?? "").toLowerCase();
  const balanceDue = firstNumber(row, ["balance_due", "amount_due", "open_amount", "remaining_amount"]);
  if (balanceDue !== null) return balanceDue > 0;
  if (["unpaid", "partial", "overdue", "open", "pending"].includes(paymentStatus)) return true;
  if (["unpaid", "partial", "overdue", "open", "pending"].includes(status)) return true;
  const dueDate = getDateValue(row, ["due_date"]);
  const totalAmount = firstNumber(row, ["total_amount", "invoice_total", "amount_total"]);
  const paidAmount = firstNumber(row, ["paid_amount", "amount_paid"]);
  return Boolean(dueDate && dueDate < today && (totalAmount ?? 0) > (paidAmount ?? 0));
}

function badgeVariantForAlert(kind: "danger" | "warning" | "info") {
  switch (kind) {
    case "danger":
      return "destructive" as const;
    case "warning":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

export default async function DashboardPage() {
  const { profile, supabase } = await requireProfile();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    { data: revenueRows, error: revenueError },
    { data: expenseRows, error: expenseError },
    { data: projectRows, error: projectError },
    { data: taskRows, error: taskError },
    { data: invoiceRows, error: invoiceError },
    { data: inventoryRows, error: inventoryError },
    { data: productRows, error: productError },
    { data: customerRows, error: customerError },
    { data: userRows, error: userError },
  ] = await Promise.all([
    supabase.from("sales_financials_view").select("*").limit(120),
    supabase.from("financial_expenses_view").select("*").limit(120),
    supabase
      .from("project_dashboard_view")
      .select("id,name,status,customer_id,customer_name,open_tasks,updated_at")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("task_overview_view")
      .select(
        "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_name,is_overdue,updated_at"
      )
      .order("due_date", { ascending: true })
      .limit(200),
    supabase.from("invoices").select("*").limit(200),
    supabase.from("inventory").select("product_id,quantity_on_hand,quantity_reserved").limit(500),
    supabase.from("products").select("*").limit(1000),
    supabase
      .from("customers")
      .select("id,name,name_for_invoice,registration_number,phone,email,address,active,notes")
      .limit(5000),
    supabase.from("users").select("id,full_name,email,active").limit(1000),
  ]);

  const revenueByMonth = new Map<string, number>();
  ((revenueRows ?? []) as Row[]).forEach((row) => {
    const date = getDateValue(row, ["month", "month_date", "date", "order_date", "created_at"]);
    if (!date) return;
    const amount = firstNumber(row, [
      "monthly_revenue",
      "revenue",
      "net_revenue",
      "gross_revenue",
      "total_revenue",
      "amount_total",
      "total_amount",
    ]);
    if (amount === null) return;
    const key = monthKey(date);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + amount);
  });

  const expensesByMonth = new Map<string, number>();
  ((expenseRows ?? []) as Row[]).forEach((row) => {
    const date = getDateValue(row, ["month", "expense_date", "date", "created_at"]);
    if (!date) return;
    const amount = firstNumber(row, ["monthly_expenses", "expenses", "total_expenses", "amount"]);
    if (amount === null) return;
    const key = monthKey(date);
    expensesByMonth.set(key, (expensesByMonth.get(key) ?? 0) + amount);
  });

  const currentMonth = monthKey(today);
  const previousMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonth = monthKey(previousMonthDate);

  const monthlyRevenue = revenueByMonth.get(currentMonth) ?? 0;
  const previousRevenue = revenueByMonth.get(previousMonth) ?? 0;
  const monthlyExpenses = expensesByMonth.get(currentMonth) ?? 0;
  const previousExpenses = expensesByMonth.get(previousMonth) ?? 0;

  const projects = ((projectRows ?? []) as Row[]).filter((row) =>
    isProjectActive(getString(row, "status"))
  );
  const tasks = ((taskRows ?? []) as Row[]).filter((row) => isTaskOpen(getString(row, "status")));
  const overdueTasks = tasks.filter((row) => isTaskOverdue(row, today));

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
        name: firstString(product, ["name", "sku"], "מוצר"),
        available: onHand - reserved,
      };
    })
    .filter((row) => row.productId && row.available <= 5);

  const invoiceSourceMissing =
    invoiceError?.message?.includes("Could not find the table 'public.invoices'") ?? false;

  const unpaidInvoices = invoiceSourceMissing
    ? []
    : ((invoiceRows ?? []) as Row[]).filter((row) => isInvoiceUnpaid(row, today));

  const activeProjectOptions = projects
    .map((row) => ({
      id: getString(row, "id") ?? "",
      name: firstString(row, ["name"], "פרויקט"),
      customerId: getString(row, "customer_id") ?? "",
      customerName: firstString(row, ["customer_name"], "לקוח"),
    }))
    .filter((row) => row.id && row.customerId);

  const activeUsers = ((userRows ?? []) as Row[])
    .map((row) => {
      const id = getString(row, "id") ?? "";
      const fullName = getString(row, "full_name");
      const email = getString(row, "email");
      return {
        id,
        label: fullName && fullName.trim() ? fullName : email ?? "",
        active: row.active,
      };
    })
    .filter((row) => row.id && row.label && row.active !== false)
    .map((row) => ({ id: row.id, label: row.label }));

  const dashboardErrors = [
    revenueError ? `הכנסות: ${revenueError.message}` : null,
    expenseError ? `הוצאות: ${expenseError.message}` : null,
    projectError ? `פרויקטים: ${projectError.message}` : null,
    taskError ? `משימות: ${taskError.message}` : null,
    invoiceError && !invoiceSourceMissing ? `חשבוניות: ${invoiceError.message}` : null,
    inventoryError ? `מלאי: ${inventoryError.message}` : null,
    productError ? `מוצרים: ${productError.message}` : null,
    customerError ? `לקוחות: ${customerError.message}` : null,
    userError ? `משתמשים: ${userError.message}` : null,
  ].filter(Boolean) as string[];

  const alertItems = [
    {
      title: "חשבוניות לא משולמות",
      count: unpaidInvoices.length,
      description: invoiceSourceMissing
        ? "טבלת חשבוניות לא הוגדרה עדיין"
        : unpaidInvoices.length > 0
          ? "יש חשבוניות פתוחות"
          : "אין פתוחות",
      href: "/invoices",
      kind: invoiceSourceMissing
        ? ("info" as const)
        : unpaidInvoices.length > 0
          ? ("danger" as const)
          : ("info" as const),
    },
    {
      title: "מלאי נמוך",
      count: lowInventory.length,
      description: lowInventory.length > 0 ? "יש פריטים מתחת לסף" : "תקין",
      href: "/inventory",
      kind: lowInventory.length > 0 ? ("warning" as const) : ("info" as const),
    },
    {
      title: "משימות באיחור",
      count: overdueTasks.length,
      description: overdueTasks.length > 0 ? "יש משימות לטיפול" : "אין איחורים",
      href: "/tasks",
      kind: overdueTasks.length > 0 ? ("danger" as const) : ("info" as const),
    },
  ];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <PageStack>
        <section className="flex items-center justify-start">
          <Badge variant="outline" className="w-fit text-sm">
            {new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(today)}
          </Badge>
        </section>

        {dashboardErrors.length > 0 ? (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">
              {dashboardErrors.join(" | ")}
            </CardContent>
          </Card>
        ) : null}

        <AdaptiveGrid variant="dashboardMetrics">
          <MetricCard title="הכנסות" value={formatCurrency(monthlyRevenue)} subtitle={formatDelta(monthlyRevenue, previousRevenue)} />
          <MetricCard title="הוצאות" value={formatCurrency(monthlyExpenses)} subtitle={formatDelta(monthlyExpenses, previousExpenses)} />
          <MetricCard title="פרויקטים פתוחים" value={formatCount(projects.length)} subtitle="פעילים עכשיו" />
          <MetricCard
            title="משימות פתוחות"
            value={formatCount(tasks.length)}
            subtitle={overdueTasks.length > 0 ? `${formatCount(overdueTasks.length)} באיחור` : "ללא איחור"}
          />
        </AdaptiveGrid>

        <AdaptiveGrid variant="dashboardMain">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">פעולות מהירות</CardTitle>
              <CardDescription>פתיחה מהירה של טפסים.</CardDescription>
            </CardHeader>
            <CardContent>
              <DashboardActions
                customers={(customerRows ?? []) as Row[]}
                products={(productRows ?? []) as Row[]}
                projects={activeProjectOptions}
                users={activeUsers}
                currentUserId={profile.id}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">התראות</CardTitle>
              <CardDescription>רק מה שדורש תשומת לב.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {alertItems.map((alert) => (
                <Link
                  key={alert.title}
                  href={alert.href}
                  className="flex items-center justify-between rounded-2xl border p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="space-y-1">
                    <div className="font-medium">{alert.title}</div>
                    <div className="text-sm text-muted-foreground">{alert.description}</div>
                  </div>
                  <Badge variant={badgeVariantForAlert(alert.kind)}>{formatCount(alert.count)}</Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        </AdaptiveGrid>
      </PageStack>
    </AppShell>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{title}</div>
        <ResponsiveMetricValue>{value}</ResponsiveMetricValue>
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      </CardContent>
    </Card>
  );
}
