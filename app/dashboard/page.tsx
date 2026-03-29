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

function firstString(row: Row | null | undefined, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value && value.trim()) return value;
  }
  return fallback;
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
    { data: dashboardRow, error: dashboardError },
    { data: projectRows, error: projectError },
    { data: invoiceRows, error: invoiceError },
    { data: productRows, error: productError },
    { data: customerRows, error: customerError },
    { data: userRows, error: userError },
  ] = await Promise.all([
    supabase
      .from("operations_dashboard_view")
      .select(
        "monthly_revenue,previous_month_revenue,monthly_expenses,previous_month_expenses,active_projects_count,open_tasks_count,overdue_tasks_count,low_inventory_count"
      )
      .limit(1)
      .maybeSingle(),
    supabase
      .from("project_dashboard_view")
      .select("id,name,status,customer_id,customer_name,open_tasks,updated_at")
      .order("updated_at", { ascending: false })
      .range(0, 99),
    supabase
      .from("invoices")
      .select("id,payment_status,status,balance_due,amount_due,open_amount,remaining_amount")
      .order("created_at", { ascending: false })
      .range(0, 199),
    supabase
      .from("products")
      .select("id,name,sku,barcode,description,base_price,base_cost,active")
      .order("name", { ascending: true })
      .range(0, 49),
    supabase
      .from("customer_overview_view")
      .select("customer_id,customer_name,phone,email,address")
      .order("customer_name", { ascending: true })
      .range(0, 49),
    supabase.from("users").select("id,full_name,email,active").order("full_name", { ascending: true }).range(0, 499),
  ]);

  const monthlyRevenue = getNumber((dashboardRow as Row | null) ?? undefined, "monthly_revenue") ?? 0;
  const previousRevenue =
    getNumber((dashboardRow as Row | null) ?? undefined, "previous_month_revenue") ?? 0;
  const monthlyExpenses =
    getNumber((dashboardRow as Row | null) ?? undefined, "monthly_expenses") ?? 0;
  const previousExpenses =
    getNumber((dashboardRow as Row | null) ?? undefined, "previous_month_expenses") ?? 0;
  const activeProjectsCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "active_projects_count") ?? 0;
  const openTasksCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "open_tasks_count") ?? 0;
  const overdueTasksCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "overdue_tasks_count") ?? 0;
  const lowInventoryCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "low_inventory_count") ?? 0;

  const invoiceSourceMissing =
    invoiceError?.message?.includes("Could not find the table 'public.invoices'") ?? false;

  const unpaidInvoices = invoiceSourceMissing
    ? []
    : ((invoiceRows ?? []) as Row[]).filter((row) => isInvoiceUnpaid(row));

  const activeProjectOptions = ((projectRows ?? []) as Row[])
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

  const customerOptions = ((customerRows ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "customer_id") ?? "",
      name: firstString(row, ["customer_name"], "לקוח"),
      phone: getString(row, "phone"),
      email: getString(row, "email"),
      address: getString(row, "address"),
    }))
    .filter((row) => row.id);

  const dashboardErrors = [
    dashboardError ? `דשבורד: ${dashboardError.message}` : null,
    projectError ? `פרויקטים: ${projectError.message}` : null,
    invoiceError && !invoiceSourceMissing ? `חשבוניות: ${invoiceError.message}` : null,
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
      count: lowInventoryCount,
      description: lowInventoryCount > 0 ? "יש פריטים מתחת לסף" : "תקין",
      href: "/inventory",
      kind: lowInventoryCount > 0 ? ("warning" as const) : ("info" as const),
    },
    {
      title: "משימות באיחור",
      count: overdueTasksCount,
      description: overdueTasksCount > 0 ? "יש משימות לטיפול" : "אין איחורים",
      href: "/tasks",
      kind: overdueTasksCount > 0 ? ("danger" as const) : ("info" as const),
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
          <MetricCard
            title="הכנסות"
            value={formatCurrency(monthlyRevenue)}
            subtitle={formatDelta(monthlyRevenue, previousRevenue)}
          />
          <MetricCard
            title="הוצאות"
            value={formatCurrency(monthlyExpenses)}
            subtitle={formatDelta(monthlyExpenses, previousExpenses)}
          />
          <MetricCard
            title="פרויקטים פתוחים"
            value={formatCount(activeProjectsCount)}
            subtitle="פעילים עכשיו"
          />
          <MetricCard
            title="משימות פתוחות"
            value={formatCount(openTasksCount)}
            subtitle={
              overdueTasksCount > 0 ? `${formatCount(overdueTasksCount)} באיחור` : "ללא איחור"
            }
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
                customers={customerOptions as Row[]}
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
