"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { loadDomainCashBreakdown, loadFinancialEntries } from "@/lib/financial";
import {
  isMonthKey,
  monthWindow,
  previousMonth,
  toBars,
  type DomainBar,
  type MonthKey,
} from "@/lib/dashboard/domain-chart";
import { getBooksStartDate, isMonthBeforeBooksStart } from "@/lib/settings/booksStartDate";

export type DomainChartResult = { ok: true; bars: DomainBar[] } | { ok: false; error: string };

/**
 * One month of the dashboard's per-domain cash chart, for its month picker.
 *
 * Re-checks the role here rather than trusting the card that calls it: a server
 * action is a public endpoint, and this one returns money. Same loader and same
 * window helper the server component uses for the first render, so switching to
 * the current month and reloading the page can't disagree.
 */
export async function loadDomainChartMonth(month: MonthKey): Promise<DomainChartResult> {
  if (!isMonthKey(month)) return { ok: false, error: "חודש לא תקין." };

  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    return { ok: false, error: "אין הרשאה לצפות בנתונים אלה." };
  }

  // The viewer's "today" isn't knowable here (the server runs UTC), but it only
  // matters for the current month, where a few hours either way changes nothing
  // in a chart of posted cash.
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    // Both months share one financial-entry scan — the previous month's window
    // always starts earlier, so scanning from there covers both, and each
    // month is then just an in-memory filter over the same entries instead of
    // its own full round trip.
    const currentWindow = monthWindow(month, todayIso);
    const previousWindow = monthWindow(previousMonth(month), todayIso);
    // A month before the books start date (Settings → כספים) charts as empty.
    const [{ entries }, booksStartDate] = await Promise.all([
      loadFinancialEntries(supabase, { from: previousWindow.from }),
      getBooksStartDate(supabase),
    ]);
    const [points, previous] = await Promise.all([
      isMonthBeforeBooksStart(month, booksStartDate) ? [] : loadDomainCashBreakdown(supabase, currentWindow, entries),
      isMonthBeforeBooksStart(previousMonth(month), booksStartDate)
        ? []
        : loadDomainCashBreakdown(supabase, previousWindow, entries),
    ]);
    return { ok: true, bars: toBars(points, previous) };
  } catch {
    return { ok: false, error: "טעינת הנתונים נכשלה. נסו שוב." };
  }
}
