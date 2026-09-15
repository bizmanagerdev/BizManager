// Pure logic behind the "תשלומים קבועים" tab: how recurring-expense templates
// and the other fixed outflows (salaries, loan instalments, card charges) fold
// into ONE list sorted by the day of the month the money leaves, and what the
// "monthly commitment" pill above it adds up. Client-safe; no data access.

import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import { sourceSettingKey, type OutflowSourceRow } from "@/lib/outflow-source-settings";

export type FixedPaymentRow =
  | { kind: "template"; id: string; day: number; sortTime: number; template: RecurringExpenseTemplateItem }
  | { kind: "source"; id: string; day: number; sortTime: number; source: OutflowSourceRow };

/**
 * Timestamp of a template's next payment date on/after `today` — orders the
 * list "by next payment" among rows sharing a day. Honors the interval (every
 * N months), phased off start_date (or today when unset).
 */
export function templateNextPaymentTime(t: RecurringExpenseTemplateItem, today: Date = new Date()): number {
  const base0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = t.expense_day_of_month || 1;
  if (t.frequency === "yearly") {
    const month = (t.expense_month_of_year || 1) - 1;
    for (const year of [base0.getFullYear(), base0.getFullYear() + 1]) {
      const last = new Date(year, month + 1, 0).getDate();
      const cand = new Date(year, month, Math.min(day, last));
      if (cand >= base0) return cand.getTime();
    }
    return base0.getTime();
  }
  const interval = Math.max(1, t.interval_months || 1);
  const anchor = t.start_date ? new Date(t.start_date) : base0;
  const anchorIdx = anchor.getFullYear() * 12 + anchor.getMonth();
  for (let i = 0; i < 24; i++) {
    const base = new Date(base0.getFullYear(), base0.getMonth() + i, 1);
    const diff = base.getFullYear() * 12 + base.getMonth() - anchorIdx;
    if (diff < 0 || diff % interval !== 0) continue;
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const cand = new Date(base.getFullYear(), base.getMonth(), Math.min(day, last));
    if (cand >= base0) return cand.getTime();
  }
  return base0.getTime();
}

/** A source with no next date sorts last. */
const NO_DAY = 32;

/**
 * One list, by the day of the month the money leaves — a template's pay day, a
 * source's next date — then by the concrete next date as a tiebreaker.
 */
export function buildFixedPaymentRows(
  templates: RecurringExpenseTemplateItem[],
  sources: OutflowSourceRow[],
  today: Date = new Date()
): FixedPaymentRow[] {
  const list: FixedPaymentRow[] = [
    ...templates.map((t): FixedPaymentRow => ({
      kind: "template",
      id: `template:${t.id}`,
      day: t.expense_day_of_month || 1,
      sortTime: templateNextPaymentTime(t, today),
      template: t,
    })),
    ...sources.map((s): FixedPaymentRow => ({
      kind: "source",
      id: `source:${sourceSettingKey(s.kind, s.key)}`,
      day: s.nextDate ? Number(s.nextDate.slice(8, 10)) || NO_DAY : NO_DAY,
      sortTime: s.nextDate ? new Date(`${s.nextDate.slice(0, 10)}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER,
      source: s,
    })),
  ];
  return list.sort((a, b) => a.day - b.day || a.sortTime - b.sortTime);
}

export type FixedPaymentsSummary = {
  /** Active templates. */
  activeCount: number;
  /** Active templates whose amount is only an estimate. */
  variableCount: number;
  /** Active sources of every kind. */
  sourceCount: number;
  /** Active sources that ARE a monthly amount (salaries with a monthly wage, loans on a monthly plan). */
  monthlySourceCount: number;
  /** Active loans repaid in one or a few non-monthly payments — listed, never summed. */
  oneOffLoanCount: number;
  /** Active hourly-paid workers — their wage depends on hours, never summed. */
  hourlyCount: number;
  /** Active cards — the charge is only known when the statement is processed, never summed. */
  cardCount: number;
  /** ₪ per month: fixed templates normalized to a month + monthly sources. */
  monthlyTotal: number;
};

/**
 * What the pill adds up. Templates: fixed amounts normalized to a month (yearly
 * ÷ 12, every-N-months ÷ N); variable templates are counted, not summed.
 * Sources: only those flagged `monthly` (see OutflowSourceRow.monthly) — a loan
 * repaid in one bullet next year is an obligation but not a monthly expense,
 * an hourly worker's wage depends on hours, and a card's charge is unknown
 * until the statement is processed. Those are listed and counted, not summed.
 */
export function summarizeFixedPayments(
  templates: RecurringExpenseTemplateItem[],
  sources: OutflowSourceRow[],
  isSourceActive: (source: OutflowSourceRow) => boolean = (s) => s.isActive
): FixedPaymentsSummary {
  const active = templates.filter((t) => t.is_active);
  const variableCount = active.filter((t) => t.is_variable_amount).length;
  const templatesTotal = active.reduce((sum, t) => {
    if (t.is_variable_amount) return sum;
    const per = t.frequency === "yearly" ? t.amount / 12 : t.amount / Math.max(1, t.interval_months || 1);
    return sum + per;
  }, 0);
  const activeSources = sources.filter(isSourceActive);
  const sourcesTotal = activeSources.reduce((sum, s) => sum + (s.monthly && s.amount ? s.amount : 0), 0);
  const notMonthly = activeSources.filter((s) => !s.monthly);
  return {
    activeCount: active.length,
    variableCount,
    sourceCount: activeSources.length,
    monthlySourceCount: activeSources.length - notMonthly.length,
    oneOffLoanCount: notMonthly.filter((s) => s.kind === "loan").length,
    hourlyCount: notMonthly.filter((s) => s.kind === "salary").length,
    cardCount: notMonthly.filter((s) => s.kind === "card").length,
    monthlyTotal: templatesTotal + sourcesTotal,
  };
}
