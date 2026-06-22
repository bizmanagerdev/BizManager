import Link from "next/link";
import { requireProfile } from "@/lib/auth/requireProfile";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;

function getNumber(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function ErrorCard({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <Card className="border-destructive/40">
      <CardContent className="p-4 text-sm text-destructive">{messages.join(" | ")}</CardContent>
    </Card>
  );
}

// ── Suspense fallbacks (kept close to the real layout so the swap is shift-free) ──

// Mirrors the real quick-action button grid (AdaptiveGrid "quickActions" +
// aspect-square buttons) so the loading skeleton occupies the exact same space.
export function QuickActionsFallback() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-1.5 lg:grid-cols-10">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="mx-auto aspect-square w-full max-w-[7rem] rounded-2xl" />
      ))}
    </div>
  );
}

export function WeekOverviewFallback() {
  return <Skeleton className="h-28 w-full rounded-[1.5rem]" />;
}

export function PanelsFallback() {
  return (
    <>
      <Skeleton className="h-40 w-full rounded-[1.5rem]" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-[1.5rem]" />
        <Skeleton className="h-48 w-full rounded-[1.5rem]" />
      </div>
    </>
  );
}

/** The week calendar strip — streams in its own boundary (not on the critical path). */
export async function WeekOverviewSection() {
  const { profile, supabase } = await requireProfile();
  const entries = await getScheduleEntries(supabase, { scope: "mine", userId: profile.id }).catch(
    () => [] as CalendarEntry[]
  );
  return <WeekOverview entries={entries} />;
}

/**
 * Everything below the quick actions: alerts, personal tasks/reminders, and the
 * (role-gated) operational + finance panels. Streams in its own boundary so the
 * shell, greeting, and quick-action buttons are never blocked by these heavier
 * aggregations.
 */
export async function DashboardPanels() {
  const { profile, supabase } = await requireProfile();
  const isAdminOrOffice = profile.role === "admin" || profile.role === "office";
  const isAdmin = profile.role === "admin";

  // Recurring-task generation does a write + a few round-trips. Run it
  // concurrently with the reads (awaited below) rather than blocking ahead of
  // them. Trade-off: on the rare day a template first fires, its tasks appear on
  // the next load.
  const recurringTasksPromise = isAdminOrOffice
    ? ensureRecurringTasksForDate(supabase).catch(() => undefined)
    : Promise.resolve(undefined);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const forecastHorizon = new Date(today);
  forecastHorizon.setUTCDate(forecastHorizon.getUTCDate() + 30);
  const forecastHorizonIso = forecastHorizon.toISOString().slice(0, 10);
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;

  const [
    alertsResult,
    myTasks,
    reminders,
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
    getAlertsData(supabase, { viewerRole: profile.role }),
    getMyTasks(supabase, profile.id),
    getOpenReminders(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as Reminder[]),
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

  // Let the recurring-tasks write (started above) finish before responding.
  await recurringTasksPromise;

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

  return (
    <>
      <ErrorCard messages={alertsResult.errors.dashboard ? [`התראות: ${alertsResult.errors.dashboard}`] : []} />

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
    </>
  );
}
