import type { GlobalSearchReason } from "@/lib/global-search";
import { formatShortDate, formatTimeOnly, toDateKey } from "@/lib/date";
import { formatCurrencyAmount, formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/fx/currencies";
import {
  fuzzyAlternatives,
  gsNorm,
  parseGlobalQuery,
  type GlobalSearchToken,
  type UnderstoodPart,
} from "@/lib/search/global-query";

// The global search's rules, for a list that is already on the screen — the
// bank register, the ledger, the tasks board, checks, collections, workers
// (owner, 2026-10-19: "run them on the same engine as the global search").
// What was typed is read by the same parser (parseGlobalQuery), and a row is
// matched the way public.global_search matches a record:
//
//  - every word must be found in one of the row's words (final letters, quote
//    marks and niqqud folded; a misspelt word also by its close spellings that
//    exist in the list — "באין" → "ביאן");
//  - an amount ("1447", "₪1,447") equals one of the row's amounts, or stands as
//    a number in its words — typed with a currency ("$1,000", "1000 קנדי"), only
//    an amount in that currency; a date ("15/10") is one of its days; an hour
//    ("14:30") is in its words; a phone ("050-1234567") is one of its phones,
//    whatever dashes or +972 either side was written with.
//
// Each match says why (GlobalSearchReason), for the fields the row doesn't
// already show: a field with a null label is on the row itself (painted there),
// never repeated under it.

type Field<T> = readonly [label: string | null, value: T | null | undefined];

/** An amount, in ₪ unless it says its currency (a row in US$ / C$ gives its dollars too). */
type AmountField = readonly [label: string | null, value: number | null | undefined, currency?: CurrencyCode | null];

export type SearchRecord = {
  /** Words. A null label = shown on the row itself. */
  text?: ReadonlyArray<Field<string>>;
  amounts?: ReadonlyArray<AmountField>;
  /** A day ("YYYY-MM-DD") or an instant — compared as Israel's calendar day. */
  dates?: ReadonlyArray<Field<string>>;
  phones?: ReadonlyArray<Field<string>>;
};

type Token = {
  /** Patterns for the token as words (any accepted spelling); empty for a bare date/hour. */
  words: RegExp[];
  /** The spellings as typed and fixed — what's painted. */
  spellings: string[];
  amount?: number;
  /** The currency the amount was typed with; none: any. */
  currency?: CurrencyCode;
  date?: string;
  phone?: string;
  hour?: RegExp;
};

export type ListSearchQuery = {
  query: string;
  tokens: Token[];
  /** What to paint yellow: the words (as typed and fixed), hours, and the query itself. */
  terms: string[];
  understood: UnderstoodPart[];
  /** Close spellings searched for a misspelt word. */
  corrections: string[];
};

const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

/** Text the way the search reads it: lower case, final letters folded, quote marks and niqqud dropped, 1,000 → 1000. */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (ch) => FINALS[ch] ?? ch)
    .replace(/["'`´׳״’‘֑-ׇ]/g, "")
    .replace(/(\d),(?=\d)/g, "$1");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordPattern(word: string, wholeNumber: boolean): RegExp {
  const body = escapeRegExp(word);
  // A number on its own: 1000 is not inside 10000, nor the 1000 of 1000.50.
  return wholeNumber ? new RegExp(`(^|[^0-9a-z.,:])${body}(?![0-9a-z]|[.,:][0-9])`) : new RegExp(body);
}

function toToken(raw: GlobalSearchToken): Token {
  const spellings = (raw.t ?? []).filter(Boolean);
  return {
    words: spellings.map((word) => wordPattern(word, Boolean(raw.w))),
    spellings,
    amount: raw.a,
    currency: raw.c,
    date: raw.d,
    phone: raw.p,
    hour: raw.h ? new RegExp(`(^|[^0-9])${raw.h}(?![0-9])`) : undefined,
  };
}

function isSpecial(token: Token) {
  return token.amount !== undefined || token.date !== undefined || token.phone !== undefined || token.hour !== undefined;
}

/**
 * What was typed, ready to match rows with. `vocabulary` (the list's own words,
 * see listVocabulary) adds close spellings for a misspelt word.
 */
export function prepareListSearch(
  query: string,
  options: { vocabulary?: readonly string[]; today?: string } = {}
): ListSearchQuery | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const parsed = parseGlobalQuery(trimmed, options.today);
  if (parsed.tokens.length === 0) return null;
  const corrections: string[] = [];
  const raw = parsed.tokens.map((token) => {
    const typed = token.t?.[0];
    const plainWord = typed && token.a === undefined && !token.d && !token.p && !token.h;
    if (!plainWord || !options.vocabulary || typed.length < 3) return token;
    const alternatives = fuzzyAlternatives(typed, options.vocabulary);
    corrections.push(...alternatives);
    return alternatives.length > 0 ? { ...token, t: [typed, ...alternatives] } : token;
  });
  const tokens = raw.map(toToken);
  const terms = Array.from(
    new Set([...raw.flatMap((token) => [...(token.t ?? []), ...(token.h ? [token.h] : [])]), trimmed].filter(Boolean))
  );
  return { query: trimmed, tokens, terms, understood: parsed.understood, corrections: Array.from(new Set(corrections)) };
}

/** Every word of the list's rows — what a misspelt word may be fixed to. */
export function listVocabulary(records: Iterable<SearchRecord>): string[] {
  const words = new Set<string>();
  for (const record of records) {
    for (const [, value] of record.text ?? []) {
      if (!value) continue;
      for (const word of gsNorm(value).split(" ")) if (word.length >= 3 && !/^\d+$/.test(word)) words.add(word);
    }
  }
  return [...words];
}

function phoneMatches(value: string, phone: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return false;
  if (digits.includes(phone)) return true;
  // A 0-prefixed number also as +972.
  return phone.startsWith("0") && phone.length > 1 && digits.includes(`972${phone.slice(1)}`);
}

function sameAmount(value: number, amount: number) {
  return Math.abs(value - amount) < 0.005;
}

type Hit = { kind: GlobalSearchReason["kind"]; label: string | null; value: string };

/** Where this token is found in the row: every field that holds it, dates and amounts first. */
function hitsFor(token: Token, record: SearchRecord, folded: Array<{ label: string | null; raw: string; text: string }>): Hit[] {
  const hits: Hit[] = [];
  if (token.date) {
    for (const [label, value] of record.dates ?? []) {
      if (value && toDateKey(value) === token.date) hits.push({ kind: "date", label, value: formatShortDate(value) });
    }
  }
  if (token.amount !== undefined) {
    for (const [label, value, inCurrency] of record.amounts ?? []) {
      const currency = inCurrency ?? "ILS";
      if (token.currency && token.currency !== currency) continue;
      if (typeof value === "number" && Number.isFinite(value) && sameAmount(value, token.amount)) {
        hits.push({ kind: "amount", label, value: currency === "ILS" ? formatMoney(value) : formatCurrencyAmount(value, currency) });
      }
    }
  }
  if (token.phone) {
    for (const [label, value] of record.phones ?? []) {
      if (value && phoneMatches(value, token.phone)) hits.push({ kind: "phone", label, value });
    }
  }
  for (const field of folded) {
    const found = token.hour ? token.hour.test(field.text) : token.words.some((pattern) => pattern.test(field.text));
    if (found) hits.push({ kind: "text", label: field.label, value: field.raw });
  }
  return hits;
}

/**
 * Does the row match — and why? null = it doesn't. An empty list = it does,
 * and everything that matched is on the row itself.
 */
export function matchSearchRecord(record: SearchRecord, search: ListSearchQuery): GlobalSearchReason[] | null {
  const folded = (record.text ?? [])
    .filter((field): field is readonly [string | null, string] => typeof field[1] === "string" && field[1].trim() !== "")
    .map(([label, raw]) => ({ label, raw, text: foldForSearch(raw) }));
  const reasons: GlobalSearchReason[] = [];
  for (const token of search.tokens) {
    if (token.words.length === 0 && !isSpecial(token)) continue;
    const hits = hitsFor(token, record, folded);
    if (hits.length === 0) return null;
    // Shown on the row: painted there, nothing to add.
    if (hits.some((hit) => hit.label === null)) continue;
    const first = hits[0];
    if (!reasons.some((reason) => reason.label === first.label && reason.value === first.value)) {
      reasons.push({ kind: first.kind, label: first.label as string, value: first.value });
    }
  }
  return reasons;
}

export type ListSearchResult<T> = {
  search: ListSearchQuery;
  /** The rows that match, in the list's own order. */
  items: T[];
  /** Why a matched row came up (fields it doesn't show). */
  reasons: Map<T, GlobalSearchReason[]>;
};

/**
 * Search a list: the rows that match `query`, in their own order, with why.
 * null when nothing was typed. A misspelt word is also looked for by its close
 * spellings among the list's own words, as the global search does.
 */
export function searchList<T>(
  items: readonly T[],
  toRecord: (item: T) => SearchRecord,
  query: string,
  options: { today?: string } = {}
): ListSearchResult<T> | null {
  if (!query.trim()) return null;
  const records = items.map(toRecord);
  const needsVocabulary = parseGlobalQuery(query, options.today).words.some((word) => word.length >= 3);
  const search = prepareListSearch(query, {
    today: options.today,
    vocabulary: needsVocabulary ? listVocabulary(records) : undefined,
  });
  if (!search) return null;
  const matched: T[] = [];
  const reasons = new Map<T, GlobalSearchReason[]>();
  items.forEach((item, index) => {
    const why = matchSearchRecord(records[index], search);
    if (!why) return;
    matched.push(item);
    reasons.set(item, why);
  });
  return { search, items: matched, reasons };
}

/**
 * A picker's options whose texts match `query` — by these rules (a misspelt
 * word, final letters, an amount), or simply containing what was typed (a date
 * written into a label, "12/10"). In the list's own order.
 */
export function filterByText<T>(
  items: readonly T[],
  texts: (item: T) => ReadonlyArray<string | null | undefined>,
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const found = searchList(items, (item) => ({ text: texts(item).map((text) => [null, text] as const) }), query);
  return items.filter(
    (item) => Boolean(found?.reasons.has(item)) || texts(item).some((text) => Boolean(text?.toLowerCase().includes(q)))
  );
}

/** An instant's hour on Israel's clock ("14:30") — for a "when it was typed in" word field. */
export function hourOf(value: string | null | undefined): string | null {
  if (!value || !/[T ]\d{2}:\d{2}/.test(value)) return null;
  const hour = formatTimeOnly(value, "");
  return hour || null;
}
