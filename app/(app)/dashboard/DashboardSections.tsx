import type { ReactNode } from "react";
import { requireProfile } from "@/lib/auth/requireProfile";
import TodayCard from "@/components/dashboard/TodayCard";
import MyTasksPanel from "@/components/dashboard/MyTasksPanel";
import ProjectStatusCards from "@/components/dashboard/ProjectStatusCards";
import UpcomingDeliveries from "@/components/dashboard/UpcomingDeliveries";
import TaskStatusDonut from "@/components/dashboard/TaskStatusDonut";
import WorkforceOverview from "@/components/dashboard/WorkforceOverview";
import AttendanceApprovals from "@/components/dashboard/AttendanceApprovals";
import InventoryHealth from "@/components/dashboard/InventoryHealth";
import RecentActivityFeed from "@/components/dashboard/RecentActivityFeed";
import CompactFinanceStrip from "@/components/dashboard/CompactFinanceStrip";
import { getInboxView, todaySlice } from "@/lib/reminders/worklist";
import { getPaymentsDueToday, type PaymentDueToday } from "@/lib/collections";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getMyTasks, getTaskStatusCounts } from "@/lib/dashboard/tasks-overview";
import { getProjectsOverview } from "@/lib/dashboard/projects-overview";
import { getWorkforceOverview } from "@/lib/dashboard/workforce";
import { loadPhoneQueueData, type PhoneQueueData } from "@/lib/attendance/phone-reports";
import { getInventoryHealth } from "@/lib/dashboard/inventory-health";
import { sanitizePrefs, resolveWidgets, type WidgetId } from "@/lib/dashboard/widgets";
import { loadDeliveriesPage, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { getRecentAuditEvents, getDigestAnchor, getMissedDigest, type AuditFeedItem } from "@/lib/audit";
import MissedDigestBar from "@/components/dashboard/MissedDigestBar";
import { loadDomainCashBreakdown } from "@/lib/financial";
import DomainBarChart from "@/components/charts/DomainBarChart";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Row = Record<string, unknown>;

// ── Suspense fallbacks (kept close to the real layout so the swap is shift-free) ──

export function PanelsFallback() {
  return (
    <>
      <Skeleton className="h-28 w-full rounded-[1.5rem]" />
      <Skeleton className="h-40 w-full rounded-[1.5rem]" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
  // The 2-hop digest chain (anchor → digest) is kicked off here but NOT awaited;
  // it's folded into the Promise.all below so it runs CONCURRENTLY with the widget
  // queries instead of blocking ~2 sequential round-trips ahead of them.
  const digestPromise: Promise<AuditFeedItem[]> = isAdminOrOffice
    ? getDigestAnchor(supabase, profile.id, profile.digest_seen_at)
        .then((sinceIso) =>
          getMissedDigest(supabase, {
            sinceIso,
            viewerRole: role,
            excludeActorIds: [profile.id, user.id],
          }).then((r) => r.items)
        )
        .catch(() => [] as AuditFeedItem[])
    : Promise.resolve([] as AuditFeedItem[]);

  // Prefs come off the profile (loaded by requireProfile) — no extra round-trip.
  const prefs = sanitizePrefs(profile.dashboard_prefs);
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
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;

  // `workerOwed` is gated on role rather than a widget toggle because it feeds
  // the finance strip's payroll count, which is admin-only inside that widget.
  const [
    inboxResult,
    scheduleEntries,
    myTasks,
    taskStatusCounts,
    projectsOverview,
    deliveriesResult,
    workforce,
    attendanceQueue,
    inventoryHealth,
    recentActivity,
    unpaidBalanceResult,
    workerOwedResult,
    dueTodayResult,
    domainBreakdown,
    digestItems,
  ] = await Promise.all([
    // Both feed the one "היום" card: the inbox for today's DATED alerts, the
    // schedule for today's tasks / projects / reminders.
    show("today") ? getInboxView(supabase, { userId: profile.id, role }).catch(() => null) : Promise.resolve(null),
    show("today")
      ? getScheduleEntries(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as CalendarEntry[])
      : Promise.resolve([] as CalendarEntry[]),
    show("myTasks") ? getMyTasks(supabase, profile.id) : Promise.resolve([]),
    show("taskDonut") && isAdminOrOffice ? getTaskStatusCounts(supabase) : Promise.resolve(null),
    show("projects") && isAdminOrOffice ? getProjectsOverview(supabase) : Promise.resolve(null),
    // No role gate: resolveWidgets already decided, and the deliveries widget is
    // now allowed for workers too (their whole job).
    show("deliveries")
      ? loadDeliveriesPage(supabase, { page: 1, filters: { customerId: null } }).then((r) => r.deliveries).catch(() => [] as DeliveryItem[])
      : Promise.resolve([] as DeliveryItem[]),
    show("workforce") && isAdminOrOffice ? getWorkforceOverview(supabase) : Promise.resolve(null),
    // No cost: the dashboard shows the queue as counts and hours, never ₪.
    show("attendanceQueue") && isAdminOrOffice
      ? loadPhoneQueueData(supabase).catch(() => null as PhoneQueueData | null)
      : Promise.resolve(null),
    show("inventory") && isAdminOrOffice ? getInventoryHealth(supabase) : Promise.resolve(null),
    show("activity") && isAdmin ? getRecentAuditEvents(supabase, 8).then((r) => r.items).catch(() => [] as AuditFeedItem[]) : Promise.resolve([] as AuditFeedItem[]),
    show("finance") && isAdminOrOffice
      ? supabase.from("invoices").select("balance_due,payment_status").in("payment_status", ["unpaid", "partial", "overdue"]).range(0, 499)
      : Promise.resolve({ data: null, error: null }),
    isAdmin
      ? supabase.from("worker_debt_items_view").select("owed_amount").eq("source_type", "payslip").gt("owed_amount", 0.009).range(0, 999)
      : Promise.resolve({ data: null, error: null }),
    show("finance") && isAdminOrOffice ? getPaymentsDueToday(supabase).catch(() => [] as PaymentDueToday[]) : Promise.resolve([] as PaymentDueToday[]),
    show("domainChart") && isAdminOrOffice
      ? loadDomainCashBreakdown(supabase, { from: monthStartIso, to: todayIso })
          .catch(() => [] as { domainName: string; inflow: number; outflow: number }[])
      : Promise.resolve([] as { domainName: string; inflow: number; outflow: number }[]),
    digestPromise,
  ]);

  // Let the recurring-tasks write (started above) finish before responding.
  await recurringTasksPromise;

  // ── Finance counts (no ₪ totals surface — counts only) ─────────────────────
  const invoicesTableMissing = (unpaidBalanceResult as { error?: { message?: string } | null }).error?.message?.includes("Could not find") ?? false;
  const unpaidInvoices = invoicesTableMissing ? [] : ((unpaidBalanceResult.data ?? []) as Row[]);
  const openCollectionsCount = unpaidInvoices.length;
  const dueTodayCount = dueTodayResult.length;
  const workerOwedCount = ((workerOwedResult.data ?? []) as Row[]).length;

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
    today: inboxResult ? (
      // Grouped HERE (server) because it's pure rule knowledge; the card only
      // does the date bucketing, which has to happen on the viewer's clock.
      <TodayCard entries={scheduleEntries} {...todaySlice(inboxResult)} />
    ) : null,
    myTasks: myTasks.length > 0 ? <MyTasksPanel tasks={myTasks} /> : null,
    finance: show("finance") && isAdminOrOffice ? (
      <CompactFinanceStrip
        openCollections={invoicesTableMissing ? 0 : openCollectionsCount}
        dueToday={dueTodayCount}
        payrollOwed={isAdmin ? workerOwedCount : null}
      />
    ) : null,
    projects: projectsOverview ? <ProjectStatusCards statusCounts={projectsOverview.statusCounts} /> : null,
    deliveries:
      deliveriesResult.length > 0 ? (
        <UpcomingDeliveries deliveries={deliveriesResult} canOpenOrder={isAdminOrOffice} />
      ) : null,
    taskDonut: taskStatusCounts && taskStatusTotal > 0 ? <TaskStatusDonut counts={taskStatusCounts} /> : null,
    workforce: workforce ? <WorkforceOverview data={workforce} /> : null,
    attendanceQueue: attendanceQueue ? <AttendanceApprovals data={attendanceQueue} /> : null,
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
