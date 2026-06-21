import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import DashboardActions from "@/app/dashboard/DashboardActions";
import DashboardGreeting from "@/components/dashboard/DashboardGreeting";
import AlertCenter from "@/components/dashboard/AlertCenter";
import WeekOverview from "@/components/dashboard/WeekOverview";
import MyTasksPanel from "@/components/dashboard/MyTasksPanel";
import ProjectStatusCards from "@/components/dashboard/ProjectStatusCards";
import UpcomingDeliveries from "@/components/dashboard/UpcomingDeliveries";
import TaskStatusDonut from "@/components/dashboard/TaskStatusDonut";
import WorkforceOverview from "@/components/dashboard/WorkforceOverview";
import InventoryHealth from "@/components/dashboard/InventoryHealth";
import RemindersPanel from "@/components/dashboard/RemindersPanel";
import RecentActivityFeed from "@/components/dashboard/RecentActivityFeed";
import CompactFinanceStrip from "@/components/dashboard/CompactFinanceStrip";
import { getAlertsData } from "@/lib/alerts";
import { getPaymentsDueToday, type PaymentDueToday } from "@/lib/collections";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getOpenReminders, type Reminder } from "@/lib/communications";
import { getMyTasks, getTaskStatusCounts } from "@/lib/dashboard/tasks-overview";
import { getProjectsOverview } from "@/lib/dashboard/projects-overview";
import { getWorkforceOverview } from "@/lib/dashboard/workforce";
import { getInventoryHealth } from "@/lib/dashboard/inventory-health";
import { loadDeliveriesPage, type DeliveryItem } from "@/app/sales/loadDeliveries";
import { getRecentAuditEvents, type AuditFeedItem } from "@/lib/audit";
import { getCashFlowPageData } from "@/lib/cashflow";
import DomainBarChart from "@/components/charts/DomainBarChart";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SalaryAgreementRow } from "@/lib/payroll";
import { isPayrollWorkerType } from "@/lib/payroll-worker-type";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;

export const revalidate = 60;

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

function isUserRole(value: string | null): value is UserRole {
  return value === "admin" || value === "office" || value === "worker" || value === "worker_no_access";
}

export default async function DashboardPage() {
  const { profile, supabase } = await requireProfile();
  const isAdminOrOffice = profile.role === "admin" || profile.role === "office";
  const isAdmin = profile.role === "admin";

  if (isAdminOrOffice) {
    await ensureRecurringTasksForDate(supabase);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const forecastHorizon = new Date(today);
  forecastHorizon.setUTCDate(forecastHorizon.getUTCDate() + 30);
  const forecastHorizonIso = forecastHorizon.toISOString().slice(0, 10);
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;

  // Always-on data: quick-action inputs + shared/personal panels (all roles).
  const [
    { data: projectRows, error: projectError },
    { data: orderRows, error: orderError },
    { data: propertyRows, error: propertyError },
    { data: productRows, error: productError },
    { data: customerRows, error: customerError },
    { data: userRows, error: userError },
    { data: salaryAgreementRows },
    { data: currentOpenSessionRow },
    alertsResult,
    scheduleEntriesResult,
    myTasks,
    reminders,
  ] = await Promise.all([
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
      .from("products_with_last_used")
      .select("id,name,sku,barcode,description,base_price,base_cost,active")
      .order("order_count", { ascending: false })
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
    getAlertsData(supabase, { viewerRole: profile.role }),
    getScheduleEntries(supabase, { scope: "mine", userId: profile.id })
      .then((data) => ({ data, error: null as string | null }))
      .catch((error: { message?: string }) => ({
        data: [] as CalendarEntry[],
        error: error?.message ?? "שגיאה בטעינת לוח הזמנים",
      })),
    getMyTasks(supabase, profile.id),
    getOpenReminders(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as Reminder[]),
  ]);

  // Back-office data: operational panels + finance counts (gated so workers never run these).
  const [
    taskStatusCounts,
    projectsOverview,
    deliveriesResult,
    workforce,
    inventoryHealth,
    recentActivity,
    unpaidBalanceResult,
    workerOwedResult,
    dueTodayResult,
    forecastInResult,
    forecastOutResult,
    domainBreakdown,
  ] = await Promise.all([
    isAdminOrOffice ? getTaskStatusCounts(supabase) : Promise.resolve(null),
    isAdminOrOffice ? getProjectsOverview(supabase) : Promise.resolve(null),
    isAdminOrOffice
      ? loadDeliveriesPage(supabase, { page: 1, filters: { customerId: null } }).then((r) => r.deliveries).catch(() => [] as DeliveryItem[])
      : Promise.resolve([] as DeliveryItem[]),
    isAdminOrOffice ? getWorkforceOverview(supabase) : Promise.resolve(null),
    isAdminOrOffice ? getInventoryHealth(supabase) : Promise.resolve(null),
    isAdmin ? getRecentAuditEvents(supabase, 8).then((r) => r.items).catch(() => [] as AuditFeedItem[]) : Promise.resolve([] as AuditFeedItem[]),
    isAdminOrOffice
      ? supabase.from("invoices").select("balance_due,payment_status").in("payment_status", ["unpaid", "partial", "overdue"]).range(0, 499)
      : Promise.resolve({ data: null, error: null }),
    isAdmin
      ? supabase.from("worker_debt_items_view").select("owed_amount").eq("source_type", "payslip").gt("owed_amount", 0.009).range(0, 999)
      : Promise.resolve({ data: null, error: null }),
    isAdminOrOffice ? getPaymentsDueToday(supabase).catch(() => [] as PaymentDueToday[]) : Promise.resolve([] as PaymentDueToday[]),
    isAdminOrOffice
      ? supabase.from("payments").select("amount_total").eq("payment_status", "pending").not("due_date", "is", null).gte("due_date", todayIso).lte("due_date", forecastHorizonIso).range(0, 999)
      : Promise.resolve({ data: null, error: null }),
    isAdminOrOffice
      ? supabase.from("expenses").select("amount,paid_amount").in("payment_status", ["not_paid", "partial"]).gte("expense_date", todayIso).lte("expense_date", forecastHorizonIso).range(0, 999)
      : Promise.resolve({ data: null, error: null }),
    isAdminOrOffice
      ? getCashFlowPageData(supabase, { from: monthStartIso, to: todayIso, pageSize: 1 })
          .then((d) => d.domainBreakdown)
          .catch(() => [] as { domainName: string; inflow: number; outflow: number }[])
      : Promise.resolve([] as { domainName: string; inflow: number; outflow: number }[]),
  ]);

  // ── Finance counts (no ₪ totals surface — counts only) ─────────────────────
  const invoicesTableMissing = (unpaidBalanceResult as { error?: { message?: string } | null }).error?.message?.includes("Could not find") ?? false;
  const unpaidInvoices = invoicesTableMissing ? [] : ((unpaidBalanceResult.data ?? []) as Row[]);
  const openCollectionsCount = unpaidInvoices.length;
  const dueTodayCount = dueTodayResult.length;
  const workerOwedRows = (workerOwedResult.data ?? []) as Row[];
  const workerOwedCount = workerOwedRows.length;

  // Lightweight cash heads-up: near-term outflows vs expected incoming (≤30d).
  const expectedIncoming30 = ((forecastInResult.data ?? []) as Row[]).reduce((sum, r) => sum + (getNumber(r, "amount_total") ?? 0), 0);
  const workerOwedTotal = workerOwedRows.reduce((sum, r) => sum + (getNumber(r, "owed_amount") ?? 0), 0);
  const upcomingExpensesOut = ((forecastOutResult.data ?? []) as Row[]).reduce(
    (sum, r) => sum + Math.max((getNumber(r, "amount") ?? 0) - (getNumber(r, "paid_amount") ?? 0), 0),
    0
  );
  const nearTermOutflow = workerOwedTotal + upcomingExpensesOut;
  // Cash-position signal is admin-only — office sees operational totals, not cash heads-up.
  const cashTighteningSoon = isAdmin && nearTermOutflow > 0 && nearTermOutflow > expectedIncoming30;

  // Income vs expenses per business domain (current month) — one diagram.
  const domainBars = (domainBreakdown ?? [])
    .map((d) => ({ name: d.domainName, inflow: d.inflow, outflow: d.outflow }))
    .filter((d) => d.inflow > 0 || d.outflow > 0);

  // Presence flags so a hidden panel never leaves an empty half in a 2-col row.
  const hasTasks = myTasks.length > 0;
  const hasDeliveries = isAdminOrOffice && deliveriesResult.length > 0;
  const taskStatusTotal = taskStatusCounts
    ? taskStatusCounts.todo + taskStatusCounts.in_progress + taskStatusCounts.blocked + taskStatusCounts.done
    : 0;
  const hasDonut = isAdminOrOffice && taskStatusTotal > 0;
  const hasReminders = reminders.length > 0;
  const hasActivity = isAdmin && recentActivity.length > 0;

  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? "";
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "בוקר טוב" : currentHour < 18 ? "צהריים טובים" : "ערב טוב";

  // ── Data prep for DashboardActions (quick-action inputs) ───────────────────
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
    .map((row) => ({ id: getString(row, "id") ?? "", name: firstString(row, ["address"], "Property"), subtitle: "" }))
    .filter((row) => row.id);

  const activeUsers = ((userRows ?? []) as Row[])
    .map((row) => {
      const fullName = getString(row, "full_name");
      const email = getString(row, "email");
      const role = getString(row, "role");
      const workerType = row.payroll_worker_type;
      return {
        id: getString(row, "id") ?? "",
        label: fullName && fullName.trim() ? fullName : email ?? "",
        role: isUserRole(role) ? role : undefined,
        active: row.active,
        payroll_worker_type: isPayrollWorkerType(workerType) ? workerType : null,
        pay_tracking_mode: getString(row, "pay_tracking_mode"),
      };
    })
    .filter((row) => row.id && row.label && row.active !== false)
    .map((row) => ({ id: row.id, label: row.label, role: row.role, payroll_worker_type: row.payroll_worker_type, pay_tracking_mode: row.pay_tracking_mode }));

  const currentOpenSession =
    currentOpenSessionRow && typeof currentOpenSessionRow.clock_in === "string"
      ? { id: typeof currentOpenSessionRow.id === "string" ? currentOpenSessionRow.id : "", clock_in: currentOpenSessionRow.clock_in }
      : null;
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

  const scheduleEntries = scheduleEntriesResult.data ?? [];

  const dashboardErrors = [
    projectError ? `פרויקטים: ${projectError.message}` : null,
    orderError ? `הזמנות: ${orderError.message}` : null,
    propertyError ? `נכסים: ${propertyError.message}` : null,
    productError ? `מוצרים: ${productError.message}` : null,
    customerError ? `לקוחות: ${customerError.message}` : null,
    userError ? `משתמשים: ${userError.message}` : null,
    alertsResult.errors.dashboard ? `התראות: ${alertsResult.errors.dashboard}` : null,
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
            <CardContent className="p-4 text-sm text-destructive">{dashboardErrors.join(" | ")}</CardContent>
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
              scheduleEntries={scheduleEntries}
            />
          </CardContent>
        </Card>

        <WeekOverview entries={scheduleEntries} />

        <AlertCenter alerts={alertsResult.alerts} />

        {cashTighteningSoon ? (
          <Card className="border-warning/50">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div className="space-y-0.5 text-right">
                <div className="font-medium">תזרים להמשך החודש דורש תשומת לב</div>
                <div className="text-muted-foreground">ההתחייבויות הצפויות ב-30 הימים הקרובים עשויות לעלות על התקבולים הצפויים.</div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/financial/reports">לתחזית התזרים</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {isAdminOrOffice ? (
          <CompactFinanceStrip
            openCollections={invoicesTableMissing ? 0 : openCollectionsCount}
            dueToday={dueTodayCount}
            payrollOwed={isAdmin ? workerOwedCount : null}
          />
        ) : null}

        {hasTasks ? <MyTasksPanel tasks={myTasks} /> : null}

        {isAdminOrOffice && projectsOverview ? (
          <ProjectStatusCards statusCounts={projectsOverview.statusCounts} />
        ) : null}

        {hasDeliveries || hasDonut ? (
          <div className={cn("grid gap-4", hasDeliveries && hasDonut && "xl:grid-cols-2")}>
            {hasDeliveries ? <UpcomingDeliveries deliveries={deliveriesResult} /> : null}
            {hasDonut && taskStatusCounts ? <TaskStatusDonut counts={taskStatusCounts} /> : null}
          </div>
        ) : null}

        {isAdminOrOffice && workforce ? <WorkforceOverview data={workforce} /> : null}

        {isAdminOrOffice && inventoryHealth ? <InventoryHealth data={inventoryHealth} /> : null}

        {isAdminOrOffice && domainBars.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">הכנסות והוצאות לפי תחום</CardTitle>
              <CardDescription>החודש הנוכחי</CardDescription>
            </CardHeader>
            <CardContent>
              <DomainBarChart data={domainBars} />
            </CardContent>
          </Card>
        ) : null}

        {hasReminders || hasActivity ? (
          <div className={cn("grid gap-4", hasReminders && hasActivity && "xl:grid-cols-2")}>
            {hasReminders ? <RemindersPanel reminders={reminders} /> : null}
            {hasActivity ? <RecentActivityFeed items={recentActivity} /> : null}
          </div>
        ) : null}
      </PageStack>
    </AppShell>
  );
}
