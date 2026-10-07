import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDomainCashBreakdown, loadFinancialEntries, type FinancialEntry } from "@/lib/financial";
import { loadPaymentCalendarItems } from "@/lib/payables";
import { getCollectionsSummary, type CollectionsSummary } from "@/lib/collections";
import { getBooksStartDate, isMonthBeforeBooksStart } from "@/lib/settings/booksStartDate";
import { monthWindow, previousMonth, toBars, type DomainBar, type MonthKey } from "@/lib/dashboard/domain-chart";
import { subtractWorkingDays, toDateOnly } from "@/lib/dashboard/week";
import type { PaymentsSummary } from "@/components/dashboard/UpcomingPayments";

// The dashboard's money cards — payments, the income/expenses chart (and
// collections, which is getCollectionsSummary as it is) — worked out the same
// way on the server and from the device's copy (lib/powersync/dashboard-local
// .ts): the windows, the one shared scan of the financial engine, and what each
// card makes of it. Kept in one place so the two can't drift apart.

/** How far ahead the payments card looks, and how many rows it will ever show. */
export const PAYMENTS_HORIZON_DAYS = 14;
export const PAYMENTS_SHOWN_LIMIT = 12;
/** The heads-up for a payment whose own lead time was never set, in work-days. */
export const PAYMENTS_DEFAULT_LEAD_DAYS = 3;

/** ISO date N days after an ISO date, without dragging in a date library. */
export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A local Date back to its YYYY-MM-DD, matching how the calendar dates items. */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type MoneyCardDates = {
  todayIso: string;
  /** The month the chart opens on — its picker walks back from here without a page load. */
  currentMonth: MonthKey;
  currentMonthWindow: { from: string; to: string };
  previousMonthWindow: { from: string; to: string };
  /**
   * Where the ONE shared scan of the financial engine starts: the earliest
   * any money card needs (the chart's previous month; the payments card looks
   * back a month). The same whichever cards a person shows, so the server and
   * the device always scan the same window.
   */
  scanFrom: string;
};

export function moneyCardDates(todayIso: string): MoneyCardDates {
  const currentMonth = todayIso.slice(0, 7);
  const currentMonthWindow = monthWindow(currentMonth, todayIso);
  const previousMonthWindow = monthWindow(previousMonth(currentMonth), todayIso);
  // A month back, by the calendar in UTC (what the server's clock always did;
  // a phone's own time zone would put it a day off around a clock change).
  const monthBack = new Date(`${todayIso}T00:00:00Z`);
  monthBack.setUTCMonth(monthBack.getUTCMonth() - 1);
  const paymentsScanSince = monthBack.toISOString().slice(0, 10);
  const scanFrom = [paymentsScanSince, currentMonthWindow.from, previousMonthWindow.from].sort()[0];
  return { todayIso, currentMonth, currentMonthWindow, previousMonthWindow, scanFrom };
}

export type SharedFinancialEntries = { entries: FinancialEntry[]; referenceDate: string };

/** The one scan of the financial engine the payments card and the chart both read. */
export function loadMoneyCardEntries(supabase: SupabaseClient, dates: MoneyCardDates): Promise<SharedFinancialEntries> {
  return loadFinancialEntries(supabase, { from: dates.scanFrom });
}

export type PaymentLeadRow = { id?: unknown; reminder_work_days_before?: unknown };

/** Each recurring bill's "remind me N work-days before" — when it starts showing as expected. */
export async function loadPaymentLeadRows(supabase: SupabaseClient): Promise<PaymentLeadRow[]> {
  const { data, error } = await supabase
    .from("recurring_expense_templates")
    .select("id,reminder_work_days_before")
    .eq("is_active", true)
    .gt("reminder_work_days_before", 0)
    .range(0, 999);
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentLeadRow[];
}

export function loadPaymentsCalendar(supabase: SupabaseClient, shared: SharedFinancialEntries | null) {
  return loadPaymentCalendarItems(supabase, { monthsBack: 1, preloaded: shared ?? undefined });
}

/**
 * The payments card, in the calendar's three questions: what's late, what's
 * due today, what's expected over the next fortnight. Anything already paid
 * (`posted`) is history and belongs on the calendar page, not on the board —
 * except that a standing order (`autoPaid`) is never something "to pay", so it
 * stays out of the late count the way it does out of the calendar's alerts.
 */
export function buildPaymentsSummary(
  calendar: Awaited<ReturnType<typeof loadPaymentCalendarItems>> | null,
  leadRows: PaymentLeadRow[],
  todayIso: string
): PaymentsSummary {
  const paymentLeads = new Map<string, number>();
  for (const row of leadRows) {
    if (typeof row.id === "string" && typeof row.reminder_work_days_before === "number") {
      paymentLeads.set(row.id, row.reminder_work_days_before);
    }
  }

  const paymentsTodayIso = calendar?.todayIso ?? todayIso;
  const paymentsHorizonIso = addDaysIso(paymentsTodayIso, PAYMENTS_HORIZON_DAYS);
  const unpaidPayments = (calendar?.items ?? []).filter((item) => item.stage !== "posted");
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
  return {
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
}

/** The income/expenses chart card's props (without the locale), or null when this month has nothing. */
export type DomainChartData = {
  initialBars: DomainBar[];
  initialMonth: MonthKey;
  todayIso: string;
  booksStartDate: string | null;
};

/**
 * Income vs expenses per business domain, for the month the card opens on and
 * the one before (the "last month" ghost bars). Money before the books start
 * date (Settings → כספים) isn't real — a month before it charts as empty.
 */
/** Each business domain's money in and out, this month and the one before (what the chart's bars are made of). */
export type DomainBreakdowns = { current: Parameters<typeof toBars>[0]; previous: Parameters<typeof toBars>[0] };

export async function loadDomainChartBreakdowns(
  supabase: SupabaseClient,
  dates: MoneyCardDates,
  entries: FinancialEntry[] | undefined,
  booksStartDate: string | null
): Promise<DomainBreakdowns> {
  const [current, previous] = await Promise.all([
    isMonthBeforeBooksStart(dates.currentMonth, booksStartDate)
      ? []
      : loadDomainCashBreakdown(supabase, dates.currentMonthWindow, entries),
    isMonthBeforeBooksStart(previousMonth(dates.currentMonth), booksStartDate)
      ? []
      : loadDomainCashBreakdown(supabase, dates.previousMonthWindow, entries),
  ]);
  return { current, previous };
}

/**
 * The card owns its month from here on: it opens on the current month and its
 * header's picker fetches any other month itself. The widget still only
 * appears when THIS month has something — an empty board card is still an
 * empty card, picker or not.
 */
export function buildDomainChartData(
  breakdowns: DomainBreakdowns,
  dates: MoneyCardDates,
  booksStartDate: string | null
): DomainChartData | null {
  const bars = toBars(breakdowns.current, breakdowns.previous);
  return bars.length > 0
    ? { initialBars: bars, initialMonth: dates.currentMonth, todayIso: dates.todayIso, booksStartDate }
    : null;
}

export { getBooksStartDate };

export type MoneyCards = {
  payments?: PaymentsSummary;
  collections?: CollectionsSummary;
  domainChart?: DomainChartData | null;
};

/**
 * The money cards as the server works them out, for the device to compare its
 * own with (the dashboard's daily check, when the board draws them from the
 * device). A card the server couldn't work out is left out, not compared.
 */
export async function loadServerMoneyCards(
  supabase: SupabaseClient,
  todayIso: string,
  want: { payments: boolean; collections: boolean; domainChart: boolean }
): Promise<MoneyCards> {
  const dates = moneyCardDates(todayIso);
  const shared = want.payments || want.domainChart ? await loadMoneyCardEntries(supabase, dates).catch(() => null) : null;
  const [payments, collections, domainChart] = await Promise.all([
    want.payments && shared
      ? Promise.all([loadPaymentsCalendar(supabase, shared), loadPaymentLeadRows(supabase)]).then(
          ([calendar, leadRows]) => buildPaymentsSummary(calendar, leadRows, todayIso),
          () => undefined
        )
      : undefined,
    want.collections ? getCollectionsSummary(supabase, todayIso).catch(() => undefined) : undefined,
    want.domainChart && shared
      ? getBooksStartDate(supabase)
          .then(async (booksStartDate) =>
            buildDomainChartData(await loadDomainChartBreakdowns(supabase, dates, shared.entries, booksStartDate), dates, booksStartDate)
          )
          .catch(() => undefined)
      : undefined,
  ]);
  return {
    ...(payments ? { payments } : {}),
    ...(collections ? { collections } : {}),
    ...(domainChart !== undefined ? { domainChart } : {}),
  };
}
