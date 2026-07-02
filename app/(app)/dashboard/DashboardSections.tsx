import type { ReactNode } from "react";
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
import { getWorklistGroups } from "@/lib/reminders/worklist";
import { getPaymentsDueToday, type PaymentDueToday } from "@/lib/collections";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getOpenReminders, type Reminder } from "@/lib/communications";
import { getMyTasks, getTaskStatusCounts } from "@/lib/dashboard/tasks-overview";
import { getProjectsOverview } from "@/lib/dashboard/projects-overview";
import { getWorkforceOverview } from "@/lib/dashboard/workforce";
import { getInventoryHealth } from "@/lib/dashboard/inventory-health";
import { getDashboardPrefs, resolveWidgets, type WidgetId } from "@/lib/dashboard/widgets";
import { loadDeliveriesPage, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { getRecentAuditEvents, getDigestAnchor, getMissedDigest, type AuditFeedItem } from "@/lib/audit";
import MissedDigestBar from "@/components/dashboard/MissedDigestBar";
import { loadDomainCashBreakdown } from "@/lib/financial";
import DomainBarChart from "@/components/charts/DomainBarChart";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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

export function PanelsFallback() {
  return (
    <>
      <Skeleton className="h-28 w-full rounded-[1.5rem]" />
      <Skeleton className="h-40 w-full rounded-[1.5rem]" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-[1.5rem]" />
        <Skeleton className="h-48 w-full rounded-[1.5rem]" />
      </div>
    </>
  );
}

type WidgetRow = { id: WidgetId; span: 1 | 2; node: ReactNode };

/**
 * Group the ordered, present widgets into render rows: two consecutive
 * half-width (span 1) widgets share a 2-col row; everything else is its own
 * full-width row. This preserves the original side-by-side pairing
 * (deliveries+donut, reminders+activity) for ANY user-chosen order, without
 * leaving an empty half when a span-1 widget has no span-1 neighbour.
 */
function groupIntoRows(items: WidgetRow[]): WidgetRow[][] {
  const rows: WidgetRow[][] = [];
  for (let i = 0; i < items.length; ) {
    const cur = items[i];
    const next = items[i + 1];
    if (cur.span === 1 && next?.span === 1) {
      rows.push([cur, next]);
      i += 2;
    } else {
      rows.push([cur]);
      i += 1;
    }
  }
  return rows;
}

/**
 * Everything below the quick actions: alerts, personal tasks/reminders, and the
 * (role-gated) operational + finance panels. Each widget is shown/hidden/ordered
 * per the viewer's saved dashboard prefs (the "התאמת לוח" customizer); role is
 * always re-applied via resolveWidgets so prefs can never reveal a forbidden
 * widget. Hidden widgets skip their data fetch entirely. Streams in its own
 * Suspense boundary so the shell, greeting, and quick-action buttons are never
 * blocked by these heavier aggregations.
 */
export async function DashboardPanels() {
  const { profile, supabase, user } = await requireProfile();
  const role = profile.role;
  const isAdminOrOffice = role === "admin" || role === "office";
  const isAdmin = role === "admin";

  // "What you missed since last here" — admin + office, role-filtered inside.
  const digestItems: AuditFeedItem[] = isAdminOrOffice
    ? await getDigestAnchor(supabase, profile.id).then((sinceIso) =>
        getMissedDigest(supabase, {
          sinceIso,
          viewerRole: role,
          excludeActorIds: [profile.id, user.id],
        }).then((r) => r.items)
      )
    : [];

  const prefs = await getDashboardPrefs(supabase, profile.id).catch(() => null);
  const ordered = resolveWidgets(role, prefs);
  const visible = new Set(ordered.map((w) => w.id));
  const show = (id: WidgetId) => visible.has(id);

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

  // The cash-tightening banner (admin-only, conditional) is a system element —
  // it is NOT in the widget catalog and can't be hidden — so its inputs
  // (workerOwed / near-term in/out forecasts) are gated on role only, not on a
  // widget toggle.
  const [
    alertsResult,
    scheduleEntries,
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
    show("alerts") ? getWorklistGroups(supabase, { userId: profile.id, role }) : Promise.resolve(null),
    show("week")
      ? getScheduleEntries(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as CalendarEntry[])
      : Promise.resolve([] as CalendarEntry[]),
    show("myTasks") ? getMyTasks(supabase, profile.id) : Promise.resolve([]),
    show("reminders")
      ? getOpenReminders(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as Reminder[])
      : Promise.resolve([] as Reminder[]),
    show("taskDonut") && isAdminOrOffice ? getTaskStatusCounts(supabase) : Promise.resolve(null),
    show("projects") && isAdminOrOffice ? getProjectsOverview(supabase) : Promise.resolve(null),
    show("deliveries") && isAdminOrOffice
      ? loadDeliveriesPage(supabase, { page: 1, filters: { customerId: null } }).then((r) => r.deliveries).catch(() => [] as DeliveryItem[])
      : Promise.resolve([] as DeliveryItem[]),
    show("workforce") && isAdminOrOffice ? getWorkforceOverview(supabase) : Promise.resolve(null),
    show("inventory") && isAdminOrOffice ? getInventoryHealth(supabase) : Promise.resolve(null),
    show("activity") && isAdmin ? getRecentAuditEvents(supabase, 8).then((r) => r.items).catch(() => [] as AuditFeedItem[]) : Promise.resolve([] as AuditFeedItem[]),
    show("finance") && isAdminOrOffice
      ? supabase.from("invoices").select("balance_due,payment_status").in("payment_status", ["unpaid", "partial", "overdue"]).range(0, 499)
      : Promise.resolve({ data: null, error: null }),
    isAdmin
      ? supabase.from("worker_debt_items_view").select("owed_amount").eq("source_type", "payslip").gt("owed_amount", 0.009).range(0, 999)
      : Promise.resolve({ data: null, error: null }),
    show("finance") && isAdminOrOffice ? getPaymentsDueToday(supabase).catch(() => [] as PaymentDueToday[]) : Promise.resolve([] as PaymentDueToday[]),
    isAdmin
      ? supabase.from("payments").select("amount_total").eq("payment_status", "pending").not("due_date", "is", null).gte("due_date", todayIso).lte("due_date", forecastHorizonIso).range(0, 999)
      : Promise.resolve({ data: null, error: null }),
    isAdmin
      ? supabase.from("expenses").select("amount,paid_amount").in("payment_status", ["not_paid", "partial"]).gte("expense_date", todayIso).lte("expense_date", forecastHorizonIso).range(0, 999)
      : Promise.resolve({ data: null, error: null }),
    show("domainChart") && isAdminOrOffice
      ? loadDomainCashBreakdown(supabase, { from: monthStartIso, to: todayIso })
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

  const taskStatusTotal = taskStatusCounts
    ? taskStatusCounts.todo + taskStatusCounts.in_progress + taskStatusCounts.blocked + taskStatusCounts.done
    : 0;

  // ── Rendered node per widget (null when its data is empty, so we never show an
  // empty panel — mirrors the previous presence flags). ──────────────────────
  const nodes: Record<WidgetId, ReactNode> = {
    alerts: alertsResult ? <AlertCenter alerts={alertsResult} /> : null,
    week: show("week") ? <WeekOverview entries={scheduleEntries} /> : null,
    myTasks: myTasks.length > 0 ? <MyTasksPanel tasks={myTasks} /> : null,
    finance: show("finance") && isAdminOrOffice ? (
      <CompactFinanceStrip
        openCollections={invoicesTableMissing ? 0 : openCollectionsCount}
        dueToday={dueTodayCount}
        payrollOwed={isAdmin ? workerOwedCount : null}
      />
    ) : null,
    projects: projectsOverview ? <ProjectStatusCards statusCounts={projectsOverview.statusCounts} /> : null,
    deliveries: deliveriesResult.length > 0 ? <UpcomingDeliveries deliveries={deliveriesResult} /> : null,
    taskDonut: taskStatusCounts && taskStatusTotal > 0 ? <TaskStatusDonut counts={taskStatusCounts} /> : null,
    workforce: workforce ? <WorkforceOverview data={workforce} /> : null,
    inventory: inventoryHealth ? <InventoryHealth data={inventoryHealth} /> : null,
    domainChart: domainBars.length > 0 ? (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">הכנסות והוצאות לפי תחום</CardTitle>
          <CardDescription>החודש הנוכחי</CardDescription>
        </CardHeader>
        <CardContent>
          <DomainBarChart data={domainBars} />
        </CardContent>
      </Card>
    ) : null,
    reminders: reminders.length > 0 ? <RemindersPanel reminders={reminders} /> : null,
    activity: recentActivity.length > 0 ? <RecentActivityFeed items={recentActivity} /> : null,
  };

  const widgetRows = groupIntoRows(
    ordered
      .map((w) => ({ id: w.id, span: w.span, node: nodes[w.id] }))
      .filter((e): e is WidgetRow => e.node != null)
  );

  return (
    <>
      {/* "What you missed" digest — top of the dashboard, dismissible (admin + office). */}
      {isAdminOrOffice ? <MissedDigestBar initialItems={digestItems} /> : null}

      {/* System banner — critical cash warning, not user-hideable. */}
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

      {widgetRows.map((row) =>
        row.length === 2 ? (
          // grid-cols-1 base (NOT a bare `grid`, whose single implicit `auto`
          // track grows to its content and pushes a chart/list-row card wider
          // than a phone). minmax(0,1fr) + min-w-0 cells keep each card capped
          // to the column so wide content (recharts svg, long names) fits.
          <div key={row[0].id} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {row.map((w) => (
              <div key={w.id} className="min-w-0">{w.node}</div>
            ))}
          </div>
        ) : (
          <div key={row[0].id} className="min-w-0">{row[0].node}</div>
        )
      )}

      {widgetRows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            אין כרטיסים להצגה. ניתן להוסיף כרטיסים דרך «התאמת לוח».
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
