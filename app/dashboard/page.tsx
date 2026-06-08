import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { AdaptiveGrid, PageStack, ResponsiveMetricValue } from "@/components/layout/page-layout";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import DashboardActions from "@/app/dashboard/DashboardActions";
import CashFlowOverviewCard from "@/app/dashboard/cashflow/CashFlowOverviewCard";
import DomainActivityChart from "@/components/charts/DomainActivityChart";
import { getAlertsData } from "@/lib/alerts";
import { getPaymentsDueToday, type PaymentDueToday } from "@/lib/collections";
import { getScheduleEntries } from "@/lib/projectSchedule";
import { getTodayInboxData } from "@/lib/today-inbox";
import TodayInbox from "@/components/TodayInbox";
import DashboardGreeting from "@/components/dashboard/DashboardGreeting";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCashFlowPageData } from "@/lib/cashflow";
import type { SalaryAgreementRow } from "@/lib/payroll";
import { isPayrollWorkerType } from "@/lib/payroll-worker-type";

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
    scheduleEntriesResult,
    todayInbox,
  ] = await Promise.all([
    supabase
      .from("operations_dashboard_view")
      .select("active_projects_count,open_tasks_count,overdue_tasks_count,low_inventory_count")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("project_dashboard_view")
      .select("id,name,project_type,status,customer_id,customer_name,open_tasks,start_date,updated_at")
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
      .select("customer_id,customer_name,name_for_invoice,phone,email,address")
      .order("customer_name", { ascending: true })
      .range(0, 49),
    supabase.from("users").select("id,full_name,email,role,active,payroll_worker_type,pay_tracking_mode").order("full_name", { ascending: true }).range(0, 499),
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
    getScheduleEntries(supabase, { scope: "mine", userId: profile.id })
      .then((data) => ({ data, error: null as string | null }))
      .catch((error: { message?: string }) => ({
        data: [],
        error: error?.message ?? "שגיאה בטעינת לוח הזמנים",
      })),
    getTodayInboxData(supabase, profile),
  ]);

  const isAdminOrOffice = profile.role === "admin" || profile.role === "office";

  const todayIso = today.toISOString().slice(0, 10);
  const forecastHorizon = new Date(today);
  forecastHorizon.setUTCDate(forecastHorizon.getUTCDate() + 30);
  const forecastHorizonIso = forecastHorizon.toISOString().slice(0, 10);

  const [unpaidBalanceResult, workerOwedResult, openOrdersCountResult, dueTodayResult, forecastInResult, forecastOutResult] =
    await Promise.all([
      isAdminOrOffice
        ? supabase.from("invoices").select("balance_due,payment_status").in("payment_status", ["unpaid", "partial", "overdue"]).range(0, 499)
        : Promise.resolve({ data: null, error: null }),
      profile.role === "admin"
        ? supabase.from("worker_debt_items_view").select("owed_amount").eq("source_type", "payslip").gt("owed_amount", 0.009).range(0, 999)
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("order_overview_view")
        .select("order_id", { count: "estimated", head: true })
        .not("status", "in", '("completed","delivered","cancelled","canceled","closed","archived","done")'),
      isAdminOrOffice
        ? getPaymentsDueToday(supabase).catch(() => [] as PaymentDueToday[])
        : Promise.resolve([] as PaymentDueToday[]),
      // Forecast (lightweight): expected incoming — pending/post-dated payments due ≤30d.
      isAdminOrOffice
        ? supabase.from("payments").select("amount_total").eq("payment_status", "pending").not("due_date", "is", null).gte("due_date", todayIso).lte("due_date", forecastHorizonIso).range(0, 999)
        : Promise.resolve({ data: null, error: null }),
      // Forecast (lightweight): upcoming outflow — unpaid/partial expenses dated ≤30d.
      isAdminOrOffice
        ? supabase.from("expenses").select("amount,paid_amount").in("payment_status", ["not_paid", "partial"]).gte("expense_date", todayIso).lte("expense_date", forecastHorizonIso).range(0, 999)
        : Promise.resolve({ data: null, error: null }),
    ]);

  const dueTodayPayments = dueTodayResult as PaymentDueToday[];
  const dueTodayCount = dueTodayPayments.length;

  const activeProjectsCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "active_projects_count") ?? 0;
  const openTasksCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "open_tasks_count") ?? 0;
  const overdueTasksCount =
    getNumber((dashboardRow as Row | null) ?? undefined, "overdue_tasks_count") ?? 0;
  const openOrdersCount = typeof openOrdersCountResult.count === "number" ? openOrdersCountResult.count : 0;

  const invoicesTableMissing = (unpaidBalanceResult as { error?: { message?: string } | null }).error?.message?.includes("Could not find") ?? false;
  // Collections worklist — counts only (no ₪ totals on the dashboard).
  const unpaidInvoices = invoicesTableMissing ? [] : ((unpaidBalanceResult.data ?? []) as Row[]);
  const openCollectionsCount = unpaidInvoices.length;
  const overdueCollectionsCount = unpaidInvoices.filter((r) => getString(r, "payment_status") === "overdue").length;
  const workerOwedCount = ((workerOwedResult.data ?? []) as Row[]).length;

  // Lightweight cash heads-up: do near-term outflows (payroll owed + upcoming unpaid
  // expenses ≤30d) exceed the money expected to come in (pending payments due ≤30d)?
  const expectedIncoming30 = ((forecastInResult.data ?? []) as Row[]).reduce(
    (sum, r) => sum + (getNumber(r, "amount_total") ?? 0),
    0
  );
  const workerOwedTotal = ((workerOwedResult.data ?? []) as Row[]).reduce(
    (sum, r) => sum + (getNumber(r, "owed_amount") ?? 0),
    0
  );
  const upcomingExpensesOut = ((forecastOutResult.data ?? []) as Row[]).reduce(
    (sum, r) => sum + Math.max((getNumber(r, "amount") ?? 0) - (getNumber(r, "paid_amount") ?? 0), 0),
    0
  );
  const nearTermOutflow = workerOwedTotal + upcomingExpensesOut;
  const cashTighteningSoon = isAdminOrOffice && nearTermOutflow > 0 && nearTermOutflow > expectedIncoming30;

  // Personalized header: time-of-day greeting in Israel time. Parse the hour via
  // formatToParts in a neutral locale + hour12:false so we always get a clean 0–23
  // number (he-IL / 12-hour formatting otherwise yields the wrong hour).
  const israelHour =
    Number(
      new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" })
        .formatToParts(today)
        .find((part) => part.type === "hour")?.value ?? "0"
    ) % 24;
  const greeting = israelHour < 12 ? "בוקר טוב" : israelHour < 18 ? "צהריים טובים" : "ערב טוב";
  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? "";

  const activeProjectOptions = ((projectRows ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "id") ?? "",
      type: getString(row, "project_type") ?? "",
      name: firstString(row, ["name"], "פרויקט"),
      customerId: getString(row, "customer_id") ?? "",
      customerName: firstString(row, ["customer_name"], "לקוח"),
      startDate: getString(row, "start_date") ?? "",
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
      const workerType = row.payroll_worker_type;
      const payTrackingMode = getString(row, "pay_tracking_mode");
      return {
        id,
        label: fullName && fullName.trim() ? fullName : email ?? "",
        role: isUserRole(role) ? role : undefined,
        active: row.active,
        payroll_worker_type: isPayrollWorkerType(workerType) ? workerType : null,
        pay_tracking_mode: payTrackingMode,
      };
    })
    .filter((row) => row.id && row.label && row.active !== false)
    .map((row) => ({ id: row.id, label: row.label, role: row.role, payroll_worker_type: row.payroll_worker_type, pay_tracking_mode: row.pay_tracking_mode }));

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
  const alertItems = alertsResult.alerts.filter((alert) => alert.severity === "danger");

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
    scheduleEntriesResult.error ? `לוח זמנים: ${scheduleEntriesResult.error}` : null,
  ].filter(Boolean) as string[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        <section className="text-right">
          <DashboardGreeting name={firstName} initialGreeting={greeting} />
        </section>

        {dashboardErrors.length > 0 ? (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">
              {dashboardErrors.join(" | ")}
            </CardContent>
          </Card>
        ) : null}

        <TodayInbox data={todayInbox} />

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
              scheduleEntries={scheduleEntriesResult.data ?? []}
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
            {alertItems.length > 0 ? (
              alertItems.map((alert) => (
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
              ))
            ) : (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                אין התראות אדומות כרגע.
              </div>
            )}
          </CardContent>
        </Card>

        {cashTighteningSoon ? (
          <Card className="border-warning/50">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div className="space-y-0.5 text-right">
                <div className="font-medium">תזרים להמשך החודש דורש תשומת לב</div>
                <div className="text-muted-foreground">
                  ההתחייבויות הצפויות ב-30 הימים הקרובים עשויות לעלות על התקבולים הצפויים.
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/financial/reports">לתחזית התזרים</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <AdaptiveGrid variant="dashboardMain">
          <AdaptiveGrid variant="dashboardMetrics">
            <MetricCard
              title="פרויקטים פעילים"
              value={formatCount(activeProjectsCount)}
              subtitle={activeProjectsCount === 0 ? "אין פרויקטים פעילים" : `${formatCount(activeProjectsCount)} בביצוע`}
              href="/projects"
            />
            <MetricCard
              title="הזמנות פתוחות"
              value={formatCount(openOrdersCount)}
              subtitle={openOrdersCount === 0 ? "אין הזמנות פתוחות" : "ממתינות לטיפול"}
              href="/sales"
            />
            <MetricCard
              title="משימות באיחור"
              value={formatCount(overdueTasksCount)}
              subtitle={overdueTasksCount > 0 ? `${formatCount(openTasksCount)} פתוחות סה״כ` : "הכול בזמן"}
              href="/tasks"
              urgent={overdueTasksCount > 0}
            />
            {isAdminOrOffice ? (
              <MetricCard
                title="גביה פתוחה"
                value={invoicesTableMissing ? "—" : formatCount(openCollectionsCount)}
                subtitle={
                  invoicesTableMissing
                    ? "טבלת חשבוניות חסרה"
                    : overdueCollectionsCount > 0
                      ? `${formatCount(overdueCollectionsCount)} באיחור`
                      : openCollectionsCount > 0
                        ? "חשבוניות ממתינות לגבייה"
                        : "הכול שולם"
                }
                href="/collections"
                urgent={overdueCollectionsCount > 0}
              />
            ) : null}
            {isAdminOrOffice ? (
              <MetricCard
                title="לפירעון היום"
                value={formatCount(dueTodayCount)}
                subtitle={dueTodayCount > 0 ? "צ׳קים/העברות לפירעון היום" : "אין תשלומים להיום"}
                href="/collections"
                urgent={dueTodayCount > 0}
              />
            ) : null}
            {profile.role === "admin" ? (
              <MetricCard
                title="שכר לתשלום"
                value={formatCount(workerOwedCount)}
                subtitle={workerOwedCount > 0 ? "עובדים עם שכר שטרם שולם" : "אין חוב לעובדים"}
                href="/payroll"
                urgent={workerOwedCount > 0}
              />
            ) : null}
          </AdaptiveGrid>

          <CashFlowOverviewCard rows={cashFlowDomainBreakdown} />
        </AdaptiveGrid>

        {cashFlowDomainBreakdown.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="space-y-1 text-right">
                <CardTitle className="text-lg">פעילות לפי תחום</CardTitle>
                <CardDescription>
                  איזה תחום הכי פעיל — לפי מספר תנועות. צבע ירוק = עודף הכנסות, אדום = עודף הוצאות.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <DomainActivityChart
                data={cashFlowDomainBreakdown.map((r) => ({
                  name: r.domainName,
                  count: r.count,
                  net: r.net,
                }))}
                height={Math.max(180, cashFlowDomainBreakdown.length * 48)}
              />
            </CardContent>
          </Card>
        )}
      </PageStack>
    </AppShell>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  href,
  urgent,
}: {
  title: string;
  value: string;
  subtitle: string;
  href: string;
  urgent?: boolean;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">{title}</div>
          <ResponsiveMetricValue className={urgent ? "text-destructive" : undefined}>
            {value}
          </ResponsiveMetricValue>
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
        </CardContent>
      </Card>
    </Link>
  );
}
