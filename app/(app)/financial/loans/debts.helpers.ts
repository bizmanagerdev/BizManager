// Pure helpers of the חובות page — filtering, narrowing, option lists. No React,
// so they're tested in node; the components only render what these return.
import {
  DEBT_KINDS,
  debtTimingFor,
  summarizeParts,
  type DebtItem,
  type DebtKind,
  type DebtTiming,
} from "@/lib/debts";

export type TimingFilter = "all" | DebtTiming;
export type KindFilter = "all" | DebtKind;

/** The domain key an item files under in the domain filter (wages are their own). */
export function domainKeyOf(item: DebtItem): string {
  return item.kind === "wages" ? "wages" : item.businessDomain ?? "general_business";
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * The part of an item that falls in one timing bucket. A series with one
 * installment late and ten still to come must read, under "באיחור", as the one
 * late installment — not as the whole series. Returns null when nothing of the
 * item is in that bucket.
 */
export function narrowItemToTiming(item: DebtItem, timing: DebtTiming, todayIso: string): DebtItem | null {
  const parts = item.parts.filter((p) => p.amount > 0.009 && debtTimingFor(p.date, todayIso) === timing);
  if (parts.length === 0) return null;
  const open = round2(parts.reduce((s, p) => s + p.amount, 0));
  if (item.expenseLines) {
    const lines = item.expenseLines.filter((l) => debtTimingFor(l.date, todayIso) === timing);
    return {
      ...item,
      ...summarizeParts(parts, todayIso),
      parts,
      expenseLines: lines,
      total: round2(lines.reduce((s, l) => s + l.amount, 0)),
      paid: round2(lines.reduce((s, l) => s + l.paid, 0)),
      open,
    };
  }
  return {
    ...item,
    ...summarizeParts(parts, todayIso),
    parts,
    wageLines: item.wageLines?.filter((l) => debtTimingFor(l.date, todayIso) === timing),
    open,
  };
}

export type DebtFilters = {
  timing: TimingFilter;
  domain: string;
  search: string;
  kind?: KindFilter;
  account?: string;
};

/** Search, domain, kind and account narrow the list; a timing keeps only that part of each item. */
export function filterDebts(items: DebtItem[], filters: DebtFilters, todayIso: string): DebtItem[] {
  const query = filters.search.trim().toLowerCase();
  const result: DebtItem[] = [];
  for (const item of items) {
    if (filters.kind && filters.kind !== "all" && item.kind !== filters.kind) continue;
    if (filters.domain !== "all" && domainKeyOf(item) !== filters.domain) continue;
    if (filters.account && filters.account !== "all") {
      const key = item.accountId ?? "none";
      if (key !== filters.account) continue;
    }
    if (query && !item.searchText.includes(query)) continue;
    const shown = filters.timing === "all" ? item : narrowItemToTiming(item, filters.timing, todayIso);
    if (shown) result.push(shown);
  }
  return result;
}

/**
 * What the חובות tab lists: the debts that aren't loans — unpaid expenses and
 * wages. Loans have their own tab; the דוח tab still counts them, so the full
 * picture stays in one place.
 */
export function debtsTabItems(items: DebtItem[]): DebtItem[] {
  return items.filter((item) => item.kind !== "loan");
}

export function groupByKind(items: DebtItem[]): Array<{ kind: DebtKind; items: DebtItem[] }> {
  return DEBT_KINDS.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}

export function domainOptions(items: DebtItem[]): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const item of items) {
    const key = domainKeyOf(item);
    if (!seen.has(key)) seen.set(key, item.domainName);
  }
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "he"));
}

export function accountOptions(
  items: DebtItem[],
  accountNames: Map<string, string>
): Array<{ value: string; label: string }> {
  const keys = new Set(items.map((i) => i.accountId ?? "none"));
  const options = [...keys]
    .filter((k) => k !== "none")
    .map((k) => ({ value: k, label: accountNames.get(k) ?? "חשבון שנמחק" }))
    .sort((a, b) => a.label.localeCompare(b.label, "he"));
  return keys.has("none") ? [...options, { value: "none", label: "ללא חשבון" }] : options;
}

export const TIMING_FILTER_OPTIONS: Array<{ value: TimingFilter; label: string }> = [
  { value: "all", label: "הכל" },
  { value: "overdue", label: "באיחור" },
  { value: "soon", label: "ב-7 הימים הקרובים" },
  { value: "later", label: "בהמשך" },
  { value: "undated", label: "ללא תאריך" },
];

export function parseTimingFilter(value: string | null | undefined): TimingFilter {
  return TIMING_FILTER_OPTIONS.some((o) => o.value === value) ? (value as TimingFilter) : "all";
}

// ── Tabs ────────────────────────────────────────────────────────────────────
export type DebtsTab = "debts" | "loans" | "report";
export const DEBTS_TAB_PARAM = "tab";

/**
 * The tab to open on. `?tab=` wins; otherwise a loans deep link — `?repay=<id>`
 * (from the collections list) or `?focus=<loanId>` — opens the loans tab, since
 * that's the only tab those links can land on. The debts list is the default.
 */
export function initialDebtsTab(
  params: { tab: string | null; repay: string | null; focus: string | null },
  loanIds: ReadonlySet<string>
): DebtsTab {
  if (params.tab === "loans" || params.tab === "report" || params.tab === "debts") return params.tab;
  if (params.repay) return "loans";
  if (params.focus && loanIds.has(params.focus)) return "loans";
  return "debts";
}
