import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { AdaptiveGrid, PageStack, ResponsiveMetricValue } from "@/components/layout/page-layout";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import DashboardActions from "@/app/dashboard/DashboardActions";
import CashFlowOverviewCard from "@/app/dashboard/cashflow/CashFlowOverviewCard";
import { getAlertsData } from "@/lib/alerts";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCashFlowPageData } from "@/lib/cashflow";
import type { SalaryAgreementRow } from "@/lib/payroll";

type Row = Record<string, unknown>;

export const revalidate = 60;

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

function formatCount(value: number) {
  return numberFormatter.format(value);
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

function countActiveAlerts(unpaidInvoicesCount: number, lowInventoryCount: number, overdueTasksCount: number) {
  return [unpaidInvoicesCount, lowInventoryCount, overdueTasksCount].filter((count) => count > 0).length;
}

function isUserRole(value: string | null): value is UserRole {
  return value === "admin" || value === "office" || value === "worker" || value === "worker_no_access";
}

export default async function DashboardPage() {
  const { profile, supabase } = await requireProfile();

  if (profile.role === "admin" || profile.role === "office") {
    await ensureRecurringTasksForDate(supabase);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentCashFlowFrom = new Date(today);
  recentCashFlowFrom.setMonth(recentCashFlowFrom.getMonth() - 5);

  const [
    { data: dashboardRow, error: dashboardError },
    activeProjectsCountResult,
    { data: projectRows, error: projectError },
    { data: orderRows, error: orderError },
    { data: propertyRows, error: propertyError },
    { data: productRows, error: productError },
    { data: customerRows, error: customerError },
    { data: userRows, error: userError },
    { data: salaryAgreementRows, error: salaryAgreementError },
    { data: currentOpenSessionRow, error: currentOpenSessionError },
    cashFlowOverviewResult,
    alertsResult,
  ] = await Promise.all([
    supabase
      .from("operations_dashboard_view")
      .select("active_projects_count,open_tasks_count,overdue_tasks_count,low_inventory_count")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("project_dashboard_view")
      .select("id", { count: "estimated", head: true })
      .not("status", "in", '(\"quote\",\"done\",\"completed\",\"cancelled\",\"canceled\",\"archived\",\"closed\")'),
    supabase
      .from("project_dashboard_view")
      .select("id,name,project_type,status,customer_id,customer_name,open_tasks,updated_at")
      .order("updated_at", { ascending: false })
      .range(0, 99),
    supabase
      .from("order_overview_view")
      .select("order_id,customer_name,order_date,status")
      .order("order_date", { ascending: false })
      .range(0, 99),
    supabase
      .from("properties")
      .select("id,address,is_active")
      .eq("is_active", true)
      .order("address", { ascending: true })
      .range(0, 99),
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
    supabase.from("users").select("id,full_name,email,role,active").order("full_name", { ascending: true }).range(0, 499),
    supabase
      .from("salary_agreements")
      .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours")
      .order("valid_from", { ascending: false }),
    supabase
      .from("attendance_sessions")
      .select("id,clock_in")
      .eq("user_id", profile.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getCashFlowPageData(supabase, {
      from: recentCashFlowFrom.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
      pageSize: 1,
    })
      .then((data) => ({ data, error: null as string | null }))
      .catch((error: { message?: string }) => ({
        data: null,
        error: error?.message ?? "שגיאה בטעינת נתוני תזרים",
      })),
    getAlertsData(supabase, { viewerRole: profile.role }),
  ]);

  const activeProjectsCount = typeof activeProjectsCountResult.count === "number" ? activeProjectsCountResult.count : 0;
  const openTasksCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "open_tasks_count") ?? 0;
  const overdueTasksCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "overdue_tasks_count") ?? 0;

  const activeProjectOptions = ((projectRows ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "id") ?? "",
      type: getString(row, "project_type") ?? "",
      name: firstString(row, ["name"], "פרויקט"),
      customerId: getString(row, "customer_id") ?? "",
      customerName: firstString(row, ["customer_name"], "לקוח"),
    }))
    .filter((row) => row.id && row.customerId);

  const orderOptions = ((orderRows ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "order_id") ?? "",
      name: firstString(row, ["customer_name"], "Order"),
      subtitle: getString(row, "status") ?? "",
    }))
    .filter((row) => row.id);

  const propertyOptions = ((propertyRows ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "id") ?? "",
      name: firstString(row, ["address"], "Property"),
      subtitle: "",
    }))
    .filter((row) => row.id);

  const activeUsers = ((userRows ?? []) as Row[])
    .map((row) => {
      const id = getString(row, "id") ?? "";
      const fullName = getString(row, "full_name");
      const email = getString(row, "email");
      const role = getString(row, "role");
      return {
        id,
        label: fullName && fullName.trim() ? fullName : email ?? "",
        role: isUserRole(role) ? role : undefined,
        active: row.active,
      };
    })
    .filter((row) => row.id && row.label && row.active !== false)
    .map((row) => ({ id: row.id, label: row.label, role: row.role }));

  const currentOpenSession =
    currentOpenSessionRow && typeof currentOpenSessionRow.clock_in === "string"
      ? {
          id: typeof currentOpenSessionRow.id === "string" ? currentOpenSessionRow.id : "",
          clock_in: currentOpenSessionRow.clock_in,
        }
      : null;
  void currentOpenSessionError;
  void salaryAgreementError;
  const salaryAgreements = ((salaryAgreementRows ?? []) as SalaryAgreementRow[]) ?? [];

  const customerOptions = ((customerRows ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "customer_id") ?? "",
      name: firstString(row, ["customer_name"], "לקוח"),
      phone: getString(row, "phone"),
      email: getString(row, "email"),
      address: getString(row, "address"),
    }))
    .filter((row) => row.id);

  const cashFlowDomainBreakdown = cashFlowOverviewResult.data?.domainBreakdown ?? [];
  const recentTransactionCount = cashFlowOverviewResult.data?.transactions.totalCount ?? 0;
  const activeDomainCount = cashFlowDomainBreakdown.length;
  const topDomainName = cashFlowDomainBreakdown[0]?.domainName ?? "אין פעילות";
  const alertItems = alertsResult.alerts;
  const attentionCount = countActiveAlerts(
    alertItems.find((alert) => alert.id === "unpaid-invoices")?.count ?? 0,
    alertItems.find((alert) => alert.id === "low-inventory")?.count ?? 0,
    alertItems.find((alert) => alert.id === "overdue-tasks")?.count ?? 0
  );

  const dashboardErrors = [
    dashboardError ? `דשבורד: ${dashboardError.message}` : null,
    projectError ? `פרויקטים: ${projectError.message}` : null,
    orderError ? `הזמנות: ${orderError.message}` : null,
    propertyError ? `נכסים: ${propertyError.message}` : null,
    productError ? `מוצרים: ${productError.message}` : null,
    customerError ? `לקוחות: ${customerError.message}` : null,
    userError ? `משתמשים: ${userError.message}` : null,
    cashFlowOverviewResult.error ? `תזרים: ${cashFlowOverviewResult.error}` : null,
    alertsResult.errors.dashboard ? `התראות: ${alertsResult.errors.dashboard}` : null,
    alertsResult.errors.projects ? `פרויקטים: ${alertsResult.errors.projects}` : null,
    alertsResult.errors.invoices ? `התראות חשבוניות: ${alertsResult.errors.invoices}` : null,
    alertsResult.errors.payroll ? `התראות שכר: ${alertsResult.errors.payroll}` : null,
  ].filter(Boolean) as string[];

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

        <Card>
          <CardContent className="pt-6">
            <DashboardActions
              customers={customerOptions as Row[]}
              products={(productRows ?? []) as Row[]}
              projects={activeProjectOptions}
              orders={orderOptions}
              properties={propertyOptions}
              users={activeUsers}
              currentUserId={profile.id}
              currentUserRole={profile.role}
              currentOpenSession={currentOpenSession}
              salaryAgreements={salaryAgreements}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">התראות</CardTitle>
                <CardDescription>רק מה שדורש תשומת לב.</CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/alerts">לכל ההתראות</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {alertItems.map((alert) => (
              <Link
                key={alert.id}
                href="/alerts"
                className="flex items-center justify-between rounded-2xl border p-4 transition-colors hover:bg-muted/40"
              >
                <div className="space-y-1">
                  <div className="font-medium">{alert.title}</div>
                  <div className="text-sm text-muted-foreground">{alert.description}</div>
                </div>
                <Badge variant={badgeVariantForAlert(alert.severity)}>{formatCount(alert.count)}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <AdaptiveGrid variant="dashboardMain">
          <div className="space-y-3">
            <div className="space-y-1 text-right">
              <div className="text-lg font-semibold">סיכום</div>
              <div className="text-sm text-muted-foreground">תמונת מצב מהירה בלי להוריד פוקוס מהפעולות.</div>
            </div>
            <AdaptiveGrid variant="dashboardMetrics">
              <MetricCard
                title="תחומים פעילים"
                value={formatCount(activeDomainCount)}
                subtitle={topDomainName !== "אין פעילות" ? `מוביל כרגע: ${topDomainName}` : topDomainName}
              />
              <MetricCard
                title="תנועות אחרונות"
                value={formatCount(recentTransactionCount)}
                subtitle="לפי תחומים, בלי חשיפת סכומים"
              />
              <MetricCard
                title="פרויקטים פתוחים"
                value={formatCount(activeProjectsCount)}
                subtitle="פעילים עכשיו"
              />
              <MetricCard
                title="דורש תשומת לב"
                value={formatCount(attentionCount)}
                subtitle={attentionCount > 0 ? "יש פריטים לבדיקה" : "הכול יציב"}
              />
              <MetricCard
                title="משימות פתוחות"
                value={formatCount(openTasksCount)}
                subtitle={overdueTasksCount > 0 ? `${formatCount(overdueTasksCount)} באיחור` : "ללא איחור"}
              />
            </AdaptiveGrid>
          </div>

          <CashFlowOverviewCard rows={cashFlowDomainBreakdown} transactionCount={recentTransactionCount} />
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
