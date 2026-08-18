import { Suspense, type ReactNode } from "react";
import { requireProfile } from "@/lib/auth/requireProfile";
import TodayScheduleCard from "@/components/dashboard/TodayScheduleCard";
import TodayAlertsCard from "@/components/dashboard/TodayAlertsCard";
import MyTasksPanel from "@/components/dashboard/MyTasksPanel";
import UpcomingDeliveries from "@/components/dashboard/UpcomingDeliveries";
import AttendanceApprovals from "@/components/dashboard/AttendanceApprovals";
import WorkerShiftPanel from "@/app/(app)/dashboard/WorkerShiftPanel";
import UpcomingPayments, { type PaymentsSummary } from "@/components/dashboard/UpcomingPayments";
import { getInboxView, todaySlice } from "@/lib/reminders/worklist";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getMyTasks } from "@/lib/dashboard/tasks-overview";
import { subtractWorkingDays, toDateOnly } from "@/lib/dashboard/week";
import { formatToday } from "@/lib/dashboard/greeting";
import { loadPhoneQueueData, type PhoneQueueData } from "@/lib/attendance/phone-reports";
import { loadPaymentCalendarItems } from "@/lib/payables";
import { loadAttendanceSpark, loadDeliveriesSpark } from "@/lib/dashboard/sparklines";
import { loadAttendanceClassificationOptions } from "@/lib/payroll-page-loader";
import {
  cardTransitionName,
  sanitizePrefs,
  resolveWidgets,
  cardSize,
  BOARD_COLUMN_CLASS,
  BOARD_COLUMNS_CLASS,
  CARD_SIZE_CLASS,
  CARD_NATURAL_CLASS,
  DASHBOARD_BOARD_CLASS,
  MAX_BOARD_COLUMNS,
  type CardSize,
  type WidgetId,
} from "@/lib/dashboard/widgets";
import { cn } from "@/lib/utils";
import { loadDeliveriesPage, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { getDigestAnchor, getMissedDigest, groupAuditFeedItems, type AuditFeedItem } from "@/lib/audit";
import MissedDigestCell from "@/components/dashboard/MissedDigestCard";
import { loadDomainCashBreakdown } from "@/lib/financial";
import DomainChartCard from "@/components/dashboard/DomainChartCard";
import { monthWindow, previousMonth, toBars } from "@/lib/dashboard/domain-chart";

/** One domain's cash in a window — what loadDomainCashBreakdown returns. */
type CashPoint = { domainName: string; inflow: number; outflow: number };
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ── Suspense fallbacks (kept close to the real layout so the swap is shift-free) ──

export function PanelsFallback() {
  // The same four columns, weighted roughly like a typical board, so the swap
  // doesn't shift the page under the reader.
  const COLUMN_WEIGHTS = [[2, 2], [1, 3], [1, 3], [3]];
  return (
    <div className={cn(DASHBOARD_BOARD_CLASS, BOARD_COLUMNS_CLASS[4])}>
      {COLUMN_WEIGHTS.map((weights, col) => (
        <div key={col} className={BOARD_COLUMN_CLASS}>
          {weights.map((weight, i) => (
            <Skeleton key={i} className={cn("h-56 w-full rounded-[1.125rem] xl:min-h-0", weight > 1 ? "xl:grow-[2] xl:basis-0" : "xl:grow xl:basis-0")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A card as the board handles it: the widgets, plus the activity digest, which
 * is pinned rather than arranged and so isn't a WidgetId.
 */
type WidgetItem = {
  id: WidgetId | "digest" | "workerShift";
  /** Position in the viewer's order; the pinned digest sits ahead of all of it. */
  rank: number;
  /** What it asked for: quiet / normal / tall. */
  size: CardSize;
  /** The class its cell wears — the size, plus any per-card floor. */
  sizing: string;
  node: ReactNode;
};

/**
 * A per-card FLOOR, overriding the grow classes' shared `xl:min-h-[9rem]`.
 * A list card at 9rem still shows two rows and a "there's more" scrollbar, but a
 * chart squeezed to 9rem is a legend and a sliver: axis labels, no plot.
 *
 * The attendance card needs one for the opposite reason: its days start FOLDED,
 * so its content is a handful of one-line headings and — now that cards start at
 * their content's height — it collapsed to a sliver of its neighbours' size.
 *
 * Its floor is the folded card plus ONE open session — the point of the card is
 * to approve a shift, and a card that makes you scroll to see the shift you just
 * unfolded has failed at the one job. Beyond that it grows with what's open.
 */
const MIN_HEIGHT_CLASS: Partial<Record<WidgetId, string>> = {
  domainChart: "xl:min-h-[17rem]",
  attendanceQueue: "xl:min-h-[15rem]",
};

/** How far ahead the payments card looks, and how many rows it will ever show. */
const PAYMENTS_HORIZON_DAYS = 14;
const PAYMENTS_SHOWN_LIMIT = 12;
/** The heads-up for a payment whose own lead time was never set, in work-days. */
const PAYMENTS_DEFAULT_LEAD_DAYS = 3;

/** ISO date N days after an ISO date, without dragging in a date library. */
function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A local Date back to its YYYY-MM-DD, matching how the calendar dates items. */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * How many columns to open. A column is only full if something in it can stretch,
 * so the count follows the LIST cards, not the card count: three cards of which
 * two hold lists make two columns (both full), never three with one ending in
 * white space. A board of nothing but short cards falls back to the card count
 * and lets them stretch, since something has to fill the screen.
 */
function boardColumnCount(items: WidgetItem[]): number {
  const growers = items.filter((w) => w.size !== "quiet").length;
  return Math.max(1, Math.min(MAX_BOARD_COLUMNS, growers || items.length));
}

/**
 * Last resort for a column that ended up all natural cards (possible when the
 * short ones outnumber the lists): its last card stretches after all. A slightly
 * tall card reads better than a column that stops halfway down the screen.
 */
function fillShortColumns(columns: WidgetItem[][]): WidgetItem[][] {
  return columns.map((column) => {
    if (column.length === 0 || column.some((w) => w.size !== "quiet")) return column;
    return column.map((w, i) =>
      i === column.length - 1 ? { ...w, size: "normal" as const, sizing: CARD_SIZE_CLASS.normal } : w
    );
  });
}

/**
 * Lay the cards ACROSS the columns in the viewer's order — card 1 tops the first
 * column, card 2 the second, and so on, wrapping onto a second row underneath.
 * So the order they set in «התאמת לוח» decides position as much as size: the
 * first cards are the top row, where nothing can push them out of sight.
 *
 * Filling column by column instead (the obvious reading) is what buried "היום"
 * three cards down a column and let whatever came first eat that column's height.
 * Going across also spreads the short cards and the lists between the columns on
 * its own, so no column ends up all one or all the other.
 */
function planColumns(items: WidgetItem[], columnCount: number): WidgetItem[][] {
  const columns: WidgetItem[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((item, slot) => columns[slot % columnCount].push(item));
  return columns;
}

/**
 * The digest's size, from the same grouping the card itself will do. Its days
 * arrive folded, so what it SHOWS is one line per topic — that's what decides
 * whether it's worth a double share, not how many records are behind them.
 */
function digestGrouped(items: AuditFeedItem[]): CardSize {
  const topics = new Set(groupAuditFeedItems(items).map((g) => g.header.tableName));
  return cardSize(topics.size, { tallFrom: 5 });
}

/**
 * One widget in its column: its content's height, or a weighted share of what's
 * left. The `order` style is what puts a PHONE back into the board's running
 * order — the column wrappers are `display: contents` there, so every card is a
 * sibling and sorts by it. On desktop it's a no-op: within a column the order
 * already ascends.
 */
function WidgetCell({ item, order }: { item: WidgetItem; order: number }) {
  return (
    // `empty:hidden` because a card can decide at RUNTIME that it has nothing to
    // say — the digest renders null once you dismiss it. Without this the cell
    // survives as an empty box and its column's gap still counts it, so that
    // column starts one gap lower than the others and the card below can't grow
    // into the space.
    //
    // The hover lift is a TRANSFORM, so the card grows over its neighbours
    // without moving them — `scale` doesn't touch layout, which matters on a
    // board where the columns are measured to the viewport. `relative`+`z-10`
    // put the growing card above the cards it overlaps.
    //
    // GROWING IS THE WHOLE FEEDBACK (user, 2026-08-18: "hover should only make
    // the card grow, not add colour to it"). The cards used to take a
    // secondary/5 wash as well, which turned crossing the board into a ripple of
    // blue. Rows inside a card still tint — that's a different question ("which
    // row?"), asked at a different scale.
    //
    // Desktop only: on a phone there's no pointer to hover with, and a tap that leaves a card scaled
    // reads as broken.
    <div
      className={cn(
        "min-w-0 transition-transform duration-200 ease-out empty:hidden xl:relative xl:hover:z-10 xl:hover:scale-[1.015]",
        item.sizing
      )}
      // viewTransitionName pairs this cell's before and after when the board
      // repacks, so a card SLIDES to its new column instead of jumping there —
      // see withViewTransition, which drives the updates that cause a repack.
      style={{ order, viewTransitionName: cardTransitionName(String(item.id)) }}
    >
      {item.node}
    </div>
  );
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
  // The month the domain chart opens on — its picker can then walk backwards
  // from here without a page load.
  const currentMonth = todayIso.slice(0, 7);

  // `workerOwed` is gated on role rather than a widget toggle because it feeds
  // the finance strip's payroll count, which is admin-only inside that widget.
  const [
    inboxResult,
    scheduleEntries,
    myTasks,
    paymentsResult,
    paymentLeadRows,
    deliveriesResult,
    deliveriesSpark,
    attendanceQueue,
    attendanceSpark,
    attendanceOptions,
    domainBreakdown,
    domainPrevBreakdown,
    digestItems,
  ] = await Promise.all([
    // One feed per "היום" card: the inbox for today's DATED alerts, the schedule
    // for today's tasks / projects / reminders. Separate widgets now, so hiding
    // one card skips only its own query.
    show("todayAlerts") ? getInboxView(supabase, { userId: profile.id, role }).catch(() => null) : Promise.resolve(null),
    show("todaySchedule")
      ? getScheduleEntries(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as CalendarEntry[])
      : Promise.resolve([] as CalendarEntry[]),
    show("myTasks") ? getMyTasks(supabase, profile.id) : Promise.resolve([]),
    // The payments calendar, one month back so nothing that's already late is
    // missed. The card itself keeps only what's unpaid and near — see below.
    show("payments") && isAdminOrOffice
      ? loadPaymentCalendarItems(supabase, { monthsBack: 1 }).catch(() => null)
      : Promise.resolve(null),
    // …and each bill's own heads-up ("N work-days before"), which is what decides
    // whether an upcoming payment is alerting yet. Tolerant of the column not
    // existing (pre-20260720030000) — then nothing has a custom lead.
    show("payments") && isAdminOrOffice
      ? supabase
          .from("recurring_expense_templates")
          .select("id,reminder_work_days_before")
          .eq("is_active", true)
          .gt("reminder_work_days_before", 0)
          .range(0, 999)
          .then((r) => r.data ?? [], () => [])
      : Promise.resolve([]),
    // No role gate: resolveWidgets already decided, and the deliveries widget is
    // now allowed for workers too (their whole job).
    show("deliveries")
      ? loadDeliveriesPage(supabase, { page: 1, filters: { customerId: null } }).then((r) => r.deliveries).catch(() => [] as DeliveryItem[])
      : Promise.resolve([] as DeliveryItem[]),
    // The shape behind the count — a week of daily totals, no figures shown.
    show("deliveries") ? loadDeliveriesSpark(supabase).catch(() => [] as number[]) : Promise.resolve([] as number[]),
    // No cost: the dashboard shows the queue as hours, never ₪.
    show("attendanceQueue") && isAdminOrOffice
      ? loadPhoneQueueData(supabase).catch(() => null as PhoneQueueData | null)
      : Promise.resolve(null),
    show("attendanceQueue") && isAdminOrOffice
      ? loadAttendanceSpark(supabase).catch(() => [] as number[])
      : Promise.resolve([] as number[]),
    // Reports are approved straight from the card, and approval means picking a
    // domain / project / property — so the options ride along with the queue.
    show("attendanceQueue") && isAdminOrOffice
      ? loadAttendanceClassificationOptions(supabase).catch(() => null)
      : Promise.resolve(null),
    // Same window helper the card's month action uses, so "this month" means the
    // same thing whether it came with the page or with the picker. Two months:
    // the one on show, and the one before it as the chart's ghost baseline.
    show("domainChart") && isAdminOrOffice
      ? loadDomainCashBreakdown(supabase, monthWindow(currentMonth, todayIso)).catch(() => [] as CashPoint[])
      : Promise.resolve([] as CashPoint[]),
    show("domainChart") && isAdminOrOffice
      ? loadDomainCashBreakdown(supabase, monthWindow(previousMonth(currentMonth), todayIso)).catch(
          () => [] as CashPoint[]
        )
      : Promise.resolve([] as CashPoint[]),
    digestPromise,
  ]);

  // Let the recurring-tasks write (started above) finish before responding.
  await recurringTasksPromise;

  // Income vs expenses per business domain, for the month the card opens on.
  const domainBars = toBars(domainBreakdown ?? [], domainPrevBreakdown ?? []);

  // The dated alerts, grouped HERE (server) because that's pure rule knowledge;
  // the card only draws them. Its sibling does the date bucketing on the client,
  // which has to happen on the viewer's clock.
  const alertsSlice = inboxResult ? todaySlice(inboxResult) : null;

  // The payments card, in the calendar's three questions: what's late, what's due
  // today, what's expected over the next fortnight. Anything already paid
  // (`posted`) is history and belongs on the calendar page, not on the board —
  // except that a standing order (`autoPaid`) is never something "to pay", so it
  // stays out of the late count the way it does out of the calendar's alerts.
  const paymentLeads = new Map<string, number>();
  for (const row of paymentLeadRows as { id?: unknown; reminder_work_days_before?: unknown }[]) {
    if (typeof row.id === "string" && typeof row.reminder_work_days_before === "number") {
      paymentLeads.set(row.id, row.reminder_work_days_before);
    }
  }

  const paymentsTodayIso = paymentsResult?.todayIso ?? todayIso;
  const paymentsHorizonIso = addDaysIso(paymentsTodayIso, PAYMENTS_HORIZON_DAYS);
  const unpaidPayments = (paymentsResult?.items ?? []).filter((item) => item.stage !== "posted");
  const latePayments = unpaidPayments.filter((item) => item.date < paymentsTodayIso && !item.autoPaid);
  const todayPayments = unpaidPayments
    .filter((item) => item.date === paymentsTodayIso)
    .sort((a, b) => b.amount - a.amount);
  // "צפוי" is NOT everything in the fortnight — it's everything whose OWN alert
  // has opened. Each recurring bill carries `reminder_work_days_before` ("remind
  // me N work-days before"), the same setting the reminder rule fires on, so the
  // card and the reminder can't disagree about when a payment starts nagging. A
  // payment with no lead set falls back to PAYMENTS_DEFAULT_LEAD_DAYS rather than
  // never appearing.
  const upcomingPayments = unpaidPayments
    .filter((item) => {
      if (item.date <= paymentsTodayIso || item.date > paymentsHorizonIso) return false;
      const lead = item.recurringTemplateId ? paymentLeads.get(item.recurringTemplateId) : undefined;
      const remindIso = isoDate(subtractWorkingDays(toDateOnly(item.date) ?? new Date(), lead ?? PAYMENTS_DEFAULT_LEAD_DAYS));
      return paymentsTodayIso >= remindIso;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const sumAmounts = (items: { amount: number }[]) => items.reduce((sum, item) => sum + item.amount, 0);
  const paymentsSummary: PaymentsSummary = {
    today: todayPayments,
    todayTotal: sumAmounts(todayPayments),
    // The lists are capped; the TOTALS are not — a figure that silently stopped
    // counting at row twelve would be a lie about what is coming.
    upcoming: upcomingPayments.slice(0, PAYMENTS_SHOWN_LIMIT),
    upcomingTotal: sumAmounts(upcomingPayments),
    late: latePayments.slice(0, PAYMENTS_SHOWN_LIMIT),
    lateCount: latePayments.length,
    lateTotal: sumAmounts(latePayments),
  };
  // ── Rendered node per widget. NULL only when the widget doesn't apply to this
  // viewer at all (role, or data that failed to load) — "nothing to report" is
  // the card's own business, and every card answers it with a one-line
  // QuietCard rather than by vanishing. ─────────────────────────────────────
  const nodes: Record<WidgetId, ReactNode> = {
    // Named by the DATE; the greeting is the top bar's now (DashboardGreetingTitle).
    // The SSR snapshot comes from the server's clock and the card re-reads it on
    // the client, so a restored page can't show yesterday.
    todaySchedule: show("todaySchedule") ? (
      <TodayScheduleCard entries={scheduleEntries} initialDate={formatToday(new Date())} />
    ) : null,
    // These five no longer test for emptiness HERE: each card decides for itself
    // and collapses to a one-line QuietCard when it has nothing. A card that
    // disappears takes its own explanation with it — you're left wondering
    // whether it broke, you hid it, or there's genuinely nothing.
    todayAlerts: alertsSlice ? <TodayAlertsCard alerts={alertsSlice.alerts} /> : null,
    myTasks: <MyTasksPanel tasks={myTasks} />,
    payments: isAdminOrOffice ? <UpcomingPayments summary={paymentsSummary} /> : null,
    deliveries: (
      <UpcomingDeliveries
        deliveries={deliveriesResult}
        spark={deliveriesSpark}
        canOpenOrder={isAdminOrOffice}
      />
    ),
    attendanceQueue: attendanceQueue ? (
      <AttendanceApprovals
        data={attendanceQueue}
        spark={attendanceSpark}
        // Empty lists rather than null: the card still approves a shift whose
        // domain needs neither (e.g. a plain office shift).
        projectOptions={attendanceOptions?.projectOptions ?? []}
        propertyOptions={attendanceOptions?.propertyOptions ?? []}
      />
    ) : null,
    // The card owns its month from here on: it opens on `currentMonth` and its
    // header's picker fetches any other month itself. The widget still only
    // appears when THIS month has something — an empty board card is still an
    // empty card, picker or not.
    domainChart:
      domainBars.length > 0 ? (
        <DomainChartCard initialBars={domainBars} initialMonth={currentMonth} todayIso={todayIso} />
      ) : null,
  };

  // WHAT EACH CARD DECLARES: how many rows it holds. cardSize turns that into
  // quiet / normal / tall — the card's whole say in the layout, and a one-liner
  // per card rather than a pixel estimate nobody can check.
  //
  // `tallFrom` differs per card because a "row" isn't the same height in each: an
  // attendance report is a form with a select and three buttons, a delivery is
  // two lines, a task is one.
  const rowsOf: Partial<Record<WidgetId, { rows: number; tallFrom?: number }>> = {
    // Sizing only, so the server's UTC "today" is close enough: the card itself
    // still buckets on the VIEWER's clock, and a card one step off for the three
    // hours around midnight is not worth a round-trip.
    todaySchedule: {
      rows: scheduleEntries.filter(
        (e) => e.startDate?.slice(0, 10) === todayIso || e.endDate?.slice(0, 10) === todayIso
      ).length,
    },
    todayAlerts: { rows: alertsSlice?.alerts.length ?? 0, tallFrom: 5 },
    myTasks: { rows: myTasks.length },
    payments: { rows: todayPayments.length + paymentsSummary.upcoming.length, tallFrom: 5 },
    deliveries: { rows: deliveriesResult.length, tallFrom: 5 },
    // Its days arrive folded, so a report is a heading until you open it — but
    // opening one costs a form's worth of height, so it turns tall sooner.
    attendanceQueue: { rows: attendanceQueue?.pending.length ?? 0, tallFrom: 3 },
    // The chart draws at a fixed size whatever the data: stretching it only adds
    // white space under the axis, so it never asks for a share.
    domainChart: { rows: 0 },
  };

  const present: WidgetItem[] = ordered
    .map((w, rank) => {
      const declared = rowsOf[w.id];
      const size = cardSize(declared?.rows ?? 1, { tallFrom: declared?.tallFrom });
      return {
        id: w.id as WidgetId | "digest",
        rank,
        size,
        // cn() runs tailwind-merge, so a later min-h wins over the size class's.
        sizing: cn(CARD_SIZE_CLASS[size], MIN_HEIGHT_CLASS[w.id]),
        node: nodes[w.id],
      };
    })
    .filter((e) => e.node != null);

  // ── The board's running order ──────────────────────────────────────────────
  // TWO CARDS ARE PINNED, ahead of whatever the viewer arranged:
  //   1. "היום" — always the first card: top-right on desktop, first on a phone.
  //      It's the card the board exists to show, and a board where the day can be
  //      dragged into a corner is a board you have to search before you can read.
  //   2. "פעילות חדשה" — right after it, for the same reason in reverse: what
  //      changed while you were away is only worth anything if you see it early.
  // Everything else follows in the viewer's own order.
  //
  // The digest is planned only when it HAS something (it renders null when empty,
  // and a reserved-but-empty slot left a hole that pushed the first card out of
  // the corner). It stays mounted either way — see the render below — so its
  // realtime subscription can still bring it back without a reload.
  const digestSize = digestGrouped(digestItems);
  const digestPlanned = isAdminOrOffice && digestItems.length > 0;
  const digestCard: WidgetItem | null = digestPlanned
    ? {
        id: "digest",
        rank: -1,
        size: digestSize,
        sizing: CARD_SIZE_CLASS[digestSize],
        node: <MissedDigestCell initialItems={digestItems} planned />,
      }
    : null;

  // The worker's clock, as a card of the board rather than a strip above it —
  // directly under "היום" (user, 2026-08-18: "I want the clock under today"), so
  // his day reads as: what's on today, then punch in.
  const shiftCard: WidgetItem | null =
    role === "worker"
      ? {
          id: "workerShift",
          rank: -0.5,
          size: "quiet",
          sizing: CARD_NATURAL_CLASS,
          node: (
            <Suspense fallback={null}>
              <WorkerShiftPanel userId={profile.id} />
            </Suspense>
          ),
        }
      : null;

  const boardCards: WidgetItem[] = [
    ...present.filter((w) => w.id === "todaySchedule"),
    ...(shiftCard ? [shiftCard] : []),
    ...(digestCard ? [digestCard] : []),
    ...present.filter((w) => w.id !== "todaySchedule"),
  ];

  // The running order IS the phone order: the columns are display:contents
  // there, so every card sorts by this index rather than by its column.
  const boardOrder = new Map(boardCards.map((card, index) => [card.id, index]));
  const columnCount = boardColumnCount(boardCards);
  const columns = fillShortColumns(planColumns(boardCards, columnCount));

  return (
    // A worker's board sits UNDER his clock-in panel, so a full-viewport height
    // would push exactly that panel's worth of page below the fold. His board is
    // three cards — letting it size to content is what keeps his screen whole.
    <div
      className={cn(
        DASHBOARD_BOARD_CLASS,
        BOARD_COLUMNS_CLASS[columnCount],
        role === "worker" && "xl:h-auto"
      )}
    >
      {columns.map((column, i) => (
        <div key={i} className={BOARD_COLUMN_CLASS}>
          {column.map((w) => (
            <WidgetCell key={w.id} item={w} order={boardOrder.get(w.id) ?? 0} />
          ))}
          {/* "What you missed" when the board was planned WITHOUT it — it renders
              null while empty, so this costs nothing, but the component stays
              mounted and its realtime subscription can still bring the card back
              without a reload. When it does have something it's a planned cell
              above instead, second in the running order. */}
          {i === 0 && isAdminOrOffice && !digestPlanned ? (
            <MissedDigestCell initialItems={digestItems} />
          ) : null}
        </div>
      ))}

      {present.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            אין כרטיסים להצגה. ניתן להוסיף כרטיסים דרך «התאמת לוח».
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
