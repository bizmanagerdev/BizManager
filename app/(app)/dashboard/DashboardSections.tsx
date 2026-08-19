import { Suspense, type ReactNode } from "react";
import { requireProfile } from "@/lib/auth/requireProfile";
import TodayScheduleCard from "@/components/dashboard/TodayScheduleCard";
import TodayAlertsCard from "@/components/dashboard/TodayAlertsCard";
import MyTasksPanel from "@/components/dashboard/MyTasksPanel";
import UpcomingDeliveries from "@/components/dashboard/UpcomingDeliveries";
import AttendanceApprovals from "@/components/dashboard/AttendanceApprovals";
import WorkerShiftPanel from "@/app/(app)/dashboard/WorkerShiftPanel";
import UpcomingPayments, { type PaymentsSummary } from "@/components/dashboard/UpcomingPayments";
import CollectionsCard from "@/components/dashboard/CollectionsCard";
import { getInboxView, todaySlice } from "@/lib/reminders/worklist";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getMyTasks } from "@/lib/dashboard/tasks-overview";
import { subtractWorkingDays, toDateOnly } from "@/lib/dashboard/week";
import { formatToday } from "@/lib/dashboard/greeting";
import { loadPhoneQueueData, type PhoneQueueData } from "@/lib/attendance/phone-reports";
import { loadPaymentCalendarItems } from "@/lib/payables";
import { getCollectionsSummary } from "@/lib/collections";
import { loadAttendanceSpark, loadDeliveriesSpark } from "@/lib/dashboard/sparklines";
import { loadAttendanceClassificationOptions } from "@/lib/payroll-page-loader";
import {
  cardTransitionName,
  sanitizePrefs,
  resolveWidgets,
  tierCounts,
  BOARD_GRID_CLASS,
  CARD_FILL_CLASS,
  CARD_NATURAL_CLASS,
  DASHBOARD_BOARD_CLASS,
  FEW_CARDS_THRESHOLD,
  HERO_CELL_CLASS,
  HERO_EMPHASIS_FILL_CLASS,
  HERO_EMPHASIS_HEADER_CLASS,
  HERO_ONLY_CLASS,
  REST_COLUMN_BOTH_CLASS,
  REST_COLUMN_SECONDARY_ONLY_CLASS,
  SECONDARY_CELL_CLASS,
  SECONDARY_EMPHASIS_CLASS,
  TERTIARY_CELL_CLASS,
  TERTIARY_MUTE_CLASS,
  type WidgetId,
} from "@/lib/dashboard/widgets";
import { cn } from "@/lib/utils";
import { loadDeliveriesPage, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { getDigestAnchor, getMissedDigest, type AuditFeedItem } from "@/lib/audit";
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
  // Roughly the shape of a typical board — tall narrow hero, a wider rest
  // column beside it holding secondary over tertiary — so the swap to real
  // data doesn't shift the page under the reader. Exact counts don't matter
  // for a skeleton; the eye reads the shape.
  return (
    <div className={cn(DASHBOARD_BOARD_CLASS, BOARD_GRID_CLASS)}>
      <div className={HERO_CELL_CLASS}>
        <Skeleton className={cn("h-56 w-full rounded-[1.125rem]", CARD_FILL_CLASS)} />
      </div>
      <div className={REST_COLUMN_BOTH_CLASS}>
        <div className={SECONDARY_CELL_CLASS}>
          {[0, 1].map((i) => (
            <Skeleton key={i} className={cn("h-40 w-full rounded-[1.125rem]", CARD_FILL_CLASS)} />
          ))}
        </div>
        <div className={TERTIARY_CELL_CLASS}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className={cn("h-32 w-full rounded-[1.125rem]", CARD_FILL_CLASS)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A card as the board handles it: the widgets, plus the two cards pinned ahead
 * of the viewer's own order (the activity digest, and a worker's clock-in
 * strip) — neither is a WidgetId, since neither can be hidden or reordered.
 */
type WidgetItem = {
  id: WidgetId | "digest" | "workerShift";
  /** Position in the viewer's order; the pinned cards sit ahead of all of it. */
  rank: number;
  node: ReactNode;
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
 * Split the board's cards into hero + secondary + tertiary, from tierCounts()
 * (see widgets.ts for the counting rule). `items[0]` is always the hero — the
 * board's pinning already put "היום" (then the digest, then the worker's clock)
 * ahead of everything else, so position 0 here IS the viewer's top priority.
 */
function splitTiers(items: WidgetItem[]): {
  hero: WidgetItem | null;
  secondary: WidgetItem[];
  tertiary: WidgetItem[];
} {
  if (items.length === 0) return { hero: null, secondary: [], tertiary: [] };
  const [hero, ...rest] = items;
  const { secondary, tertiary } = tierCounts(rest.length);
  return { hero, secondary: rest.slice(0, secondary), tertiary: rest.slice(secondary, secondary + tertiary) };
}

/**
 * One card in its cell. `fill` picks CARD_FILL_CLASS (stretch to the hero
 * column / band row and share it evenly with row-mates) or CARD_NATURAL_CLASS
 * (exactly its own height — the worker's clock strip, pinned under the hero).
 * `tier` marks the rows that get their own note beyond size: "hero-fill"
 * (sparse board) vs "hero-header" (crowded, a dark header band + light text
 * instead of a border) are mutually exclusive — the hero wears exactly one,
 * never both, never neither (see FEW_CARDS_THRESHOLD); "secondary" adds
 * SECONDARY_EMPHASIS_CLASS's tint+ring, only passed when the hero is in its
 * "-header" state, so the colour lives on exactly one row of the board at a
 * time; "tertiary" strips the shadow every card has by default
 * (TERTIARY_MUTE_CLASS) unconditionally — undefined for the worker's clock
 * strip, which carries its own bespoke treatment. `order` is what puts a
 * PHONE back into the board's running order — every wrapper between this
 * cell and the board is `display: contents` there, so every card ends up a
 * sibling of every other and sorts by it. On desktop it's a no-op: position
 * already comes from which tier the card landed in.
 */
function Cell({
  item,
  fill,
  tier,
  order,
}: {
  item: WidgetItem;
  fill: boolean;
  tier?: "hero-fill" | "hero-header" | "secondary" | "tertiary";
  order: number;
}) {
  return (
    // `empty:hidden` because a card can decide at RUNTIME that it has nothing to
    // say — the digest renders null once you dismiss it. Without this the cell
    // survives as an empty box that still claims its even share of the row, and
    // the row-mates that DO have something can't grow into the space it leaves.
    //
    // The hover lift is a TRANSFORM, so the card grows over its neighbours
    // without moving them — `scale` doesn't touch layout, which matters on a
    // board measured to the viewport. `relative`+`z-10` put the growing card
    // above the cards it overlaps.
    //
    // GROWING IS THE WHOLE FEEDBACK (user, 2026-08-18: "hover should only make
    // the card grow, not add colour to it"). The cards used to take a
    // secondary/5 wash as well, which turned crossing the board into a ripple of
    // blue. Rows inside a card still tint — that's a different question ("which
    // row?"), asked at a different scale.
    //
    // Desktop only: on a phone there's no pointer to hover with, and a tap that
    // leaves a card scaled reads as broken.
    <div
      className={cn(
        "min-w-0 transition-transform duration-200 ease-out empty:hidden xl:relative xl:hover:z-10 xl:hover:scale-[1.015]",
        fill ? CARD_FILL_CLASS : CARD_NATURAL_CLASS,
        tier === "hero-fill" ? HERO_EMPHASIS_FILL_CLASS : null,
        tier === "hero-header" ? HERO_EMPHASIS_HEADER_CLASS : null,
        tier === "secondary" ? SECONDARY_EMPHASIS_CLASS : null,
        tier === "tertiary" ? TERTIARY_MUTE_CLASS : null
      )}
      // viewTransitionName pairs this cell's before and after when the board
      // repacks, so a card SLIDES to its new spot instead of jumping there —
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
    collectionsSummary,
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
    // Money coming IN. Its own narrow loader rather than getCollectionsData():
    // that one pages the whole receivables view and resolves every payment term,
    // which is right for the worklist page and far too much for a card.
    show("collections") && isAdminOrOffice
      ? getCollectionsSummary(supabase, todayIso).catch(() => null)
      : Promise.resolve(null),
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
    collections: collectionsSummary ? <CollectionsCard summary={collectionsSummary} /> : null,
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

  const present: WidgetItem[] = ordered
    .map((w, rank) => ({ id: w.id as WidgetId | "digest", rank, node: nodes[w.id] }))
    .filter((e) => e.node != null);

  // ── The board's running order ──────────────────────────────────────────────
  // TWO CARDS ARE PINNED, ahead of whatever the viewer arranged:
  //   1. "היום" — always the hero: full height, on its own side of the board on
  //      desktop, first on a phone. It's the card the board exists to show, and a
  //      board where the day can be buried among six others is a board you have
  //      to search before you can read.
  //   2. "פעילות חדשה" — right after it, for the same reason in reverse: what
  //      changed while you were away is only worth anything if you see it early.
  //      Landing right after the hero, it's always the first secondary card.
  // Everything else follows in the viewer's own order, split into the secondary
  // and tertiary rows by tierCounts() — see splitTiers below.
  //
  // The digest is planned only when it HAS something (it renders null when
  // empty). Unplanned, it stays mounted purely for its realtime subscription —
  // see the sentinel near the return, and MissedDigestCard for what happens when
  // that subscription fires on an unplanned board.
  const digestPlanned = isAdminOrOffice && digestItems.length > 0;
  const digestCard: WidgetItem | null = digestPlanned
    ? { id: "digest", rank: -1, node: <MissedDigestCell initialItems={digestItems} planned /> }
    : null;

  // The worker's clock, pinned directly under "היום" (user, 2026-08-18: "I want
  // the clock under today") — INSIDE the hero column, not a tier of its own, so
  // his day reads as: what's on today, then punch in. It never competes for a
  // secondary/tertiary slot and never grows past its own content.
  const shiftCard: WidgetItem | null =
    role === "worker"
      ? {
          id: "workerShift",
          rank: -0.5,
          node: (
            <Suspense fallback={null}>
              <WorkerShiftPanel userId={profile.id} />
            </Suspense>
          ),
        }
      : null;

  const rankedCards: WidgetItem[] = [
    ...present.filter((w) => w.id === "todaySchedule"),
    ...(digestCard ? [digestCard] : []),
    ...present.filter((w) => w.id !== "todaySchedule"),
  ];
  const { hero, secondary, tertiary } = splitTiers(rankedCards);
  const hasTertiary = tertiary.length > 0;
  const hasRest = secondary.length > 0 || hasTertiary;
  // Sparse board → the colour moves TO the hero (as a fill) and OFF the
  // secondary row (plain, no tint) — see FEW_CARDS_THRESHOLD and the
  // HERO_EMPHASIS_FILL_CLASS/HERO_EMPHASIS_HEADER_CLASS pair for why.
  // rankedCards, not present: this is about how many cards the viewer is
  // actually looking at (hero + digest + everything after), not just their
  // raw «התאמת לוח» count.
  const fewCards = rankedCards.length <= FEW_CARDS_THRESHOLD;

  // The running order IS the phone order: every wrapper between a card and the
  // board is display:contents there, so every card ends up a flat sibling and
  // sorts by this index — hero, then the clock (if any), then the two rows in
  // their normal reading order.
  const flatOrder = [hero, shiftCard, ...secondary, ...tertiary].filter((c): c is WidgetItem => c != null);
  const boardOrder = new Map(flatOrder.map((card, index) => [card.id, index]));

  return (
    <div className={cn(DASHBOARD_BOARD_CLASS, hasRest ? BOARD_GRID_CLASS : HERO_ONLY_CLASS)}>
      {hero ? (
        <div className={HERO_CELL_CLASS}>
          <Cell
            item={hero}
            fill
            tier={fewCards ? "hero-fill" : "hero-header"}
            order={boardOrder.get(hero.id) ?? 0}
          />
          {shiftCard ? <Cell item={shiftCard} fill={false} order={boardOrder.get(shiftCard.id) ?? 0} /> : null}
        </div>
      ) : null}

      {hasRest ? (
        <div className={hasTertiary ? REST_COLUMN_BOTH_CLASS : REST_COLUMN_SECONDARY_ONLY_CLASS}>
          {secondary.length > 0 ? (
            <div className={SECONDARY_CELL_CLASS}>
              {secondary.map((item) => (
                <Cell
                  key={item.id}
                  item={item}
                  fill
                  tier={fewCards ? undefined : "secondary"}
                  order={boardOrder.get(item.id) ?? 0}
                />
              ))}
            </div>
          ) : null}

          {hasTertiary ? (
            <div className={TERTIARY_CELL_CLASS}>
              {tertiary.map((item) => (
                <Cell key={item.id} item={item} fill tier="tertiary" order={boardOrder.get(item.id) ?? 0} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* "What you missed", mounted purely for its realtime subscription, when
          the board was planned WITHOUT it (nothing missed at request time). It
          renders null — no cell, no tier, nothing for the grid to lay out — so
          this costs nothing visually; if activity arrives live it refreshes the
          board itself rather than trying to draw its own cell (see
          MissedDigestCard). When it DOES have something it's a planned cell in
          the tree above instead, always the first secondary card. */}
      {isAdminOrOffice && !digestPlanned ? <MissedDigestCell initialItems={digestItems} /> : null}

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
