import { Suspense, type ReactNode } from "react";
import { requireProfile } from "@/lib/auth/requireProfile";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import TodayScheduleCard from "@/components/dashboard/TodayScheduleCard";
import TodayAlertsCard from "@/components/dashboard/TodayAlertsCard";
import MyTasksPanel from "@/components/dashboard/MyTasksPanel";
import UpcomingDeliveries from "@/components/dashboard/UpcomingDeliveries";
import AttendanceApprovals from "@/components/dashboard/AttendanceApprovals";
import WorkerShiftPanel from "@/app/(app)/dashboard/WorkerShiftPanel";
import UpcomingPayments, { type PaymentsSummary } from "@/components/dashboard/UpcomingPayments";
import CollectionsCard from "@/components/dashboard/CollectionsCard";
import PropertiesCard from "@/components/dashboard/PropertiesCard";
import { getInboxView, todaySlice } from "@/lib/reminders/worklist";
import { translateToArabic } from "@/lib/i18n/translateToHebrew";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getMyTasks } from "@/lib/dashboard/tasks-overview";
import { subtractWorkingDays, toDateOnly } from "@/lib/dashboard/week";
import { formatToday } from "@/lib/dashboard/greeting";
import { loadPhoneQueueData, type PhoneQueueData } from "@/lib/attendance/phone-reports";
import { loadPaymentCalendarItems } from "@/lib/payables";
import { getCollectionsSummary } from "@/lib/collections";
import { getPropertiesSummary } from "@/lib/properties";
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
import { loadDomainCashBreakdown, loadFinancialEntries, type FinancialEntry } from "@/lib/financial";
import DomainChartCard from "@/components/dashboard/DomainChartCard";
import { monthWindow, previousMonth, toBars, type MonthKey } from "@/lib/dashboard/domain-chart";
import type { Locale } from "@/lib/i18n/types";

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
  //
  // The xl: heights below are desktop-only and stay exactly as tuned — the
  // board is viewport-locked there (DASHBOARD_BOARD_CLASS's xl:h-[calc(...)]),
  // so every cell is stretched to fill its slot regardless of the skeleton's
  // own height and this shape can't cause a shift. Below xl there is no such
  // grid: DASHBOARD_BOARD_CLASS degrades to a plain flex-col stack and every
  // card is its own natural content height (see board-flush in globals.css),
  // so a skeleton that commits to h-56/h-40/h-32 here almost never matches the
  // real card that replaces it — usually overshooting it, so the page visibly
  // SHRINKS once data lands. The smaller bare heights below are a closer,
  // still-generic guess at a phone card's real height, chosen so the more
  // common miss is the page growing (adding content below the fold) rather
  // than shrinking (content the reader was looking at jumping away).
  return (
    <div className={cn(DASHBOARD_BOARD_CLASS, BOARD_GRID_CLASS)}>
      <div className={HERO_CELL_CLASS}>
        <Skeleton className={cn("h-28 w-full rounded-[1.125rem] xl:h-56", CARD_FILL_CLASS)} />
      </div>
      <div className={REST_COLUMN_BOTH_CLASS}>
        <div className={SECONDARY_CELL_CLASS}>
          {[0, 1].map((i) => (
            <Skeleton key={i} className={cn("h-20 w-full rounded-[1.125rem] xl:h-40", CARD_FILL_CLASS)} />
          ))}
        </div>
        <div className={TERTIARY_CELL_CLASS}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className={cn("h-16 w-full rounded-[1.125rem] xl:h-32", CARD_FILL_CLASS)} />
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
 * A slow widget's own placeholder while its query is still in flight. Sized
 * generically (not per-tier) because its eventual tier — secondary vs tertiary
 * — isn't decided until AFTER this node is built (see `present` below); the
 * outer Cell wrapper already gives it a real flex-grow box on desktop, so
 * `h-full` fills that. Below xl (see PanelsFallback for why) cards are their
 * own natural height, so a fixed fallback height stands in until real content
 * swaps it out.
 */
function SlowCardSkeleton() {
  return <Skeleton className={cn("h-16 w-full rounded-[1.125rem] xl:h-full", CARD_FILL_CLASS)} />;
}

/**
 * The five heaviest widgets (payments, collections, attendance queue,
 * properties, the domain chart — each a multi-table scan) each get their own
 * async cell + Suspense boundary instead of gating the WHOLE board's first
 * paint on the slowest of them. today/tasks/activity/deliveries stay in the
 * eager batch in DashboardPanels below (see the comment there) — they're
 * fast, indexed, single-purpose queries, and for a worker (who never sees any
 * of these five) they're the entire board, so his dashboard now never waits
 * on anything past that first batch.
 *
 * Each cell repeats its own widget's null-when-empty rule exactly as the
 * inline version used to — only the WHEN changed (streamed in later instead
 * of blocking the initial Promise.all), never the WHAT.
 */
async function PaymentsSlowCell({
  paymentsPromise,
  paymentLeadRowsPromise,
  todayIso,
  locale,
}: {
  paymentsPromise: Promise<Awaited<ReturnType<typeof loadPaymentCalendarItems>> | null>;
  paymentLeadRowsPromise: Promise<{ id?: unknown; reminder_work_days_before?: unknown }[]>;
  todayIso: string;
  locale: Locale;
}) {
  const [paymentsResult, paymentLeadRows] = await Promise.all([paymentsPromise, paymentLeadRowsPromise]);

  // The payments card, in the calendar's three questions: what's late, what's
  // due today, what's expected over the next fortnight. Anything already paid
  // (`posted`) is history and belongs on the calendar page, not on the board —
  // except that a standing order (`autoPaid`) is never something "to pay", so
  // it stays out of the late count the way it does out of the calendar's
  // alerts.
  const paymentLeads = new Map<string, number>();
  for (const row of paymentLeadRows) {
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
  return <UpcomingPayments summary={paymentsSummary} locale={locale} />;
}

async function CollectionsSlowCell({
  summaryPromise,
  locale,
}: {
  summaryPromise: Promise<Awaited<ReturnType<typeof getCollectionsSummary>> | null>;
  locale: Locale;
}) {
  const summary = await summaryPromise;
  return summary ? <CollectionsCard summary={summary} locale={locale} /> : null;
}

async function AttendanceQueueSlowCell({
  dataPromise,
  sparkPromise,
  optionsPromise,
  locale,
}: {
  dataPromise: Promise<PhoneQueueData | null>;
  sparkPromise: Promise<number[]>;
  optionsPromise: Promise<Awaited<ReturnType<typeof loadAttendanceClassificationOptions>> | null>;
  locale: Locale;
}) {
  const [data, spark, options] = await Promise.all([dataPromise, sparkPromise, optionsPromise]);
  if (!data) return null;
  return (
    <AttendanceApprovals
      data={data}
      spark={spark}
      // Empty lists rather than null: the card still approves a shift whose
      // domain needs neither (e.g. a plain office shift).
      projectOptions={options?.projectOptions ?? []}
      propertyOptions={options?.propertyOptions ?? []}
      locale={locale}
    />
  );
}

async function PropertiesSlowCell({
  summaryPromise,
  locale,
}: {
  summaryPromise: Promise<Awaited<ReturnType<typeof getPropertiesSummary>> | null>;
  locale: Locale;
}) {
  const summary = await summaryPromise;
  return summary ? <PropertiesCard summary={summary} locale={locale} /> : null;
}

async function DomainChartSlowCell({
  breakdownPromise,
  prevBreakdownPromise,
  currentMonth,
  todayIso,
  locale,
}: {
  breakdownPromise: Promise<CashPoint[]>;
  prevBreakdownPromise: Promise<CashPoint[]>;
  currentMonth: MonthKey;
  todayIso: string;
  locale: Locale;
}) {
  // Income vs expenses per business domain, for the month the card opens on.
  const [domainBreakdown, domainPrevBreakdown] = await Promise.all([breakdownPromise, prevBreakdownPromise]);
  const domainBars = toBars(domainBreakdown, domainPrevBreakdown);
  // The card owns its month from here on: it opens on `currentMonth` and its
  // header's picker fetches any other month itself. The widget still only
  // appears when THIS month has something — an empty board card is still an
  // empty card, picker or not.
  return domainBars.length > 0 ? (
    <DomainChartCard initialBars={domainBars} initialMonth={currentMonth} todayIso={todayIso} locale={locale} />
  ) : null;
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
  const locale = profile.locale;
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
  const ordered = resolveWidgets(role, prefs, profile.deliveries_access);
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

  // The payments card and both domain-chart bars each need their own read of
  // the SAME financial engine (loadFinancialEntries scans payments, expenses,
  // worker pay, receivables, loans...) over nearly the same recent window — as
  // three separate calls that was three near-duplicate full scans. One shared
  // scan, over the widest window any of them needs, replaces all three; each
  // then just filters/maps the same in-memory entries (cheap, no round trip).
  const needPayments = show("payments") && isAdminOrOffice;
  const needDomainChart = show("domainChart") && isAdminOrOffice;
  const currentMonthWindow = monthWindow(currentMonth, todayIso);
  const previousMonthWindow = monthWindow(previousMonth(currentMonth), todayIso);
  const paymentsScanSince = (() => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const sharedFinancialFrom = [
    needPayments ? paymentsScanSince : null,
    needDomainChart ? currentMonthWindow.from : null,
    needDomainChart ? previousMonthWindow.from : null,
  ]
    .filter((v): v is string => v != null)
    .sort()[0];
  const financialEntriesPromise: Promise<{ entries: FinancialEntry[]; referenceDate: string } | null> =
    sharedFinancialFrom
      ? loadFinancialEntries(supabase, { from: sharedFinancialFrom }).catch(() => null)
      : Promise.resolve(null);

  // ── SLOW group (payments, collections, attendance queue, properties, the
  // domain chart) — every one of these is a multi-table scan. Kicked off here
  // but deliberately NOT awaited in this function: each streams into its own
  // Suspense boundary via the *SlowCell components above, at whatever cell the
  // board's layout below assigns it, instead of making today/tasks/activity/
  // deliveries (the FAST group, awaited below) wait on the heaviest queries on
  // the page just because they all used to share one Promise.all.
  const paymentsPromise = needPayments
    ? financialEntriesPromise
        .then((shared) => loadPaymentCalendarItems(supabase, { monthsBack: 1, preloaded: shared ?? undefined }))
        .catch(() => null)
    : Promise.resolve(null);
  const paymentLeadRowsPromise: Promise<{ id?: unknown; reminder_work_days_before?: unknown }[]> =
    show("payments") && isAdminOrOffice
      ? Promise.resolve(
          supabase
            .from("recurring_expense_templates")
            .select("id,reminder_work_days_before")
            .eq("is_active", true)
            .gt("reminder_work_days_before", 0)
            .range(0, 999)
            .then((r) => r.data ?? [], () => [])
        )
      : Promise.resolve([]);
  const collectionsPromise = show("collections") && isAdminOrOffice
    ? getCollectionsSummary(supabase, todayIso).catch(() => null)
    : Promise.resolve(null);
  const attendanceQueuePromise = show("attendanceQueue") && isAdminOrOffice
    ? loadPhoneQueueData(supabase).catch(() => null as PhoneQueueData | null)
    : Promise.resolve(null);
  const attendanceSparkPromise = show("attendanceQueue") && isAdminOrOffice
    ? loadAttendanceSpark(supabase).catch(() => [] as number[])
    : Promise.resolve([] as number[]);
  const attendanceOptionsPromise = show("attendanceQueue") && isAdminOrOffice
    ? loadAttendanceClassificationOptions(supabase).catch(() => null)
    : Promise.resolve(null);
  const propertiesPromise = show("properties") && isAdminOrOffice
    ? getPropertiesSummary(supabase, todayIso).catch(() => null)
    : Promise.resolve(null);
  const domainBreakdownPromise = needDomainChart
    ? financialEntriesPromise
        .then((shared) => loadDomainCashBreakdown(supabase, currentMonthWindow, shared?.entries))
        .catch(() => [] as CashPoint[])
    : Promise.resolve([] as CashPoint[]);
  const domainPrevBreakdownPromise = needDomainChart
    ? financialEntriesPromise
        .then((shared) => loadDomainCashBreakdown(supabase, previousMonthWindow, shared?.entries))
        .catch(() => [] as CashPoint[])
    : Promise.resolve([] as CashPoint[]);

  // ── FAST group — today's schedule, today's DATED alerts, my tasks,
  // deliveries, and the activity digest. Awaited here so these are on the
  // board's very first flush: every one is a single, narrow, now-indexed
  // query, and for a worker (who never sees any of the five slow widgets
  // above) this fast group IS his whole board — nothing on it waits on
  // anything else ever again.
  const [inboxResult, scheduleEntries, myTasks, deliveriesResult, deliveriesSpark, digestItems] = await Promise.all([
    // The inbox for today's DATED alerts; the schedule for today's tasks /
    // projects / reminders. Separate widgets, so hiding one skips only its
    // own query.
    show("todayAlerts") ? getInboxView(supabase, { userId: profile.id, role }).catch(() => null) : Promise.resolve(null),
    show("todaySchedule")
      ? getScheduleEntries(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as CalendarEntry[])
      : Promise.resolve([] as CalendarEntry[]),
    show("myTasks") ? getMyTasks(supabase, profile.id, locale) : Promise.resolve([]),
    // No role gate: resolveWidgets already decided, and the deliveries widget is
    // now allowed for workers too (their whole job).
    show("deliveries")
      ? loadDeliveriesPage(supabase, { page: 1, filters: { customerId: null } }).then((r) => r.deliveries).catch(() => [] as DeliveryItem[])
      : Promise.resolve([] as DeliveryItem[]),
    // The shape behind the count — a week of daily totals, no figures shown.
    show("deliveries") ? loadDeliveriesSpark(supabase).catch(() => [] as number[]) : Promise.resolve([] as number[]),
    digestPromise,
  ]);

  // Let the recurring-tasks write (started above) finish before responding.
  await recurringTasksPromise;

  // The dated alerts, grouped HERE (server) because that's pure rule knowledge;
  // the card only draws them. Its sibling does the date bucketing on the client,
  // which has to happen on the viewer's clock.
  let alertsSlice = inboxResult ? todaySlice(inboxResult) : null;
  // Alert titles are computed from live data in Hebrew only (not stored per
  // locale) — translated here for an Arabic-locale worker, same as
  // /api/reminders/page-alerts.
  if (alertsSlice && locale === "ar" && alertsSlice.alerts.length > 0) {
    const translatedAlerts = await Promise.all(
      alertsSlice.alerts.map(async (a) => ({ ...a, title: (await translateToArabic(a.title)) ?? a.title }))
    );
    alertsSlice = { ...alertsSlice, alerts: translatedAlerts };
  }

  // ── Node per widget. The four fast ones above are ready now — real content
  // or null, exactly as before. The five slow ones are a Suspense boundary
  // around one of the *SlowCell components above, which awaits its OWN
  // promise independently — the board's shell, order and sizing (computed
  // below from `present`) never wait on them; each cell just fills in
  // wherever it landed once its own query resolves.
  //
  // A slow widget's node is non-null here whenever its fetch was even
  // attempted (mirroring its promise's own gate above), even though the
  // eventual content might turn out empty — so `present` below is an
  // OPTIMISTIC read for those five, not the final truth. If one resolves
  // with nothing to show, its cell collapses via `empty:hidden` (see Cell)
  // and its row-mates absorb the freed space, exactly like the digest's own
  // null-render already does today. The only cost of that optimism is a
  // possible one-widget miscount in the "few cards" cosmetic threshold
  // (FEW_CARDS_THRESHOLD) on a day one of them is genuinely empty — never a
  // broken layout.
  const nodes: Record<WidgetId, ReactNode> = {
    // Named by the DATE; the greeting is the top bar's now (DashboardGreetingTitle).
    // The SSR snapshot comes from the server's clock and the card re-reads it on
    // the client, so a restored page can't show yesterday.
    todaySchedule: show("todaySchedule") ? (
      <TodayScheduleCard entries={scheduleEntries} initialDate={formatToday(new Date(), locale)} locale={locale} />
    ) : null,
    todayAlerts: alertsSlice ? <TodayAlertsCard alerts={alertsSlice.alerts} locale={locale} /> : null,
    myTasks: <MyTasksPanel tasks={myTasks} locale={locale} />,
    // Deliveries is a Hebrew-only feature (user, 2026-08-19: "only Hebrew
    // workers need deliveries") — never shown to an Arabic-locale worker,
    // regardless of their dashboard widget prefs.
    deliveries:
      locale === "ar" ? null : (
        <UpcomingDeliveries
          deliveries={deliveriesResult}
          spark={deliveriesSpark}
          canOpenOrder={isAdminOrOffice}
        />
      ),
    payments: isAdminOrOffice ? (
      <Suspense fallback={<SlowCardSkeleton />}>
        <PaymentsSlowCell
          paymentsPromise={paymentsPromise}
          paymentLeadRowsPromise={paymentLeadRowsPromise}
          todayIso={todayIso}
          locale={locale}
        />
      </Suspense>
    ) : null,
    collections: show("collections") && isAdminOrOffice ? (
      <Suspense fallback={<SlowCardSkeleton />}>
        <CollectionsSlowCell summaryPromise={collectionsPromise} locale={locale} />
      </Suspense>
    ) : null,
    attendanceQueue: show("attendanceQueue") && isAdminOrOffice ? (
      <Suspense fallback={<SlowCardSkeleton />}>
        <AttendanceQueueSlowCell
          dataPromise={attendanceQueuePromise}
          sparkPromise={attendanceSparkPromise}
          optionsPromise={attendanceOptionsPromise}
          locale={locale}
        />
      </Suspense>
    ) : null,
    properties: show("properties") && isAdminOrOffice ? (
      <Suspense fallback={<SlowCardSkeleton />}>
        <PropertiesSlowCell summaryPromise={propertiesPromise} locale={locale} />
      </Suspense>
    ) : null,
    domainChart: needDomainChart ? (
      <Suspense fallback={<SlowCardSkeleton />}>
        <DomainChartSlowCell
          breakdownPromise={domainBreakdownPromise}
          prevBreakdownPromise={domainPrevBreakdownPromise}
          currentMonth={currentMonth}
          todayIso={todayIso}
          locale={locale}
        />
      </Suspense>
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
    ? { id: "digest", rank: -1, node: <MissedDigestCell initialItems={digestItems} planned locale={locale} /> }
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
              <WorkerShiftPanel userId={profile.id} locale={locale} />
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
      {isAdminOrOffice && !digestPlanned ? <MissedDigestCell initialItems={digestItems} locale={locale} /> : null}

      {present.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {t(dashboardDict, locale, "noCardsMessage")}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
