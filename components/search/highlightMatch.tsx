import { Fragment, type ReactNode } from "react";
import { osaDistance } from "@/lib/search/customerMatch";

// Paint in yellow what a search matched, so the reader sees WHY a row came up
// (owner, 2026-10-18: "show me what I searched and highlight it yellow so I
// know that's the part"). Pure (no hooks) — safe in server and client
// components.
//
// Matching is done the way the search itself matches: a final letter equals
// its regular form (כהן ⇄ כהנ), quote marks and niqqud inside a word are
// skipped (צק finds צ׳ק, מקט finds מק״ט), a thousands comma between digits is
// skipped (1000 finds 1,000), case is ignored. The painted span covers the
// original characters, quote marks included.
//
// Like the search, it also finds (owner, 2026-10-19: "it should paint whatever
// it found matching so I understand"):
//  - digits across a dash, space, slash or bracket between them — "236" lights
//    "2-36" inside 050-632-3624, "15/10" lights "15/10" in 15/10/26;
//  - a misspelt word — "באין" lights "ביאן", a slip in a half-typed word lights
//    the word it was the start of.

const MARK_CLASS = "rounded bg-yellow-200/90 px-0.5 text-inherit dark:bg-yellow-500/35";

const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const SKIPPED = /["'`´׳״’‘֑-ׇ]/;
const WORD_CHAR = /[0-9a-zא-ת؀-ۿ]/;
const DIGIT_SEPARATOR = /[,\s\-/().+]/;
// Where a typed search splits into pieces when it isn't found whole.
const TERM_PARTS = /[\s\-/().+,:;|·@_]+/;

/** Edits a word may be off by and still be the one searched for (customerMatch's own steps). */
function fuzzyThreshold(length: number) {
  if (length <= 2) return 0;
  if (length <= 4) return 1;
  if (length <= 7) return 2;
  return 3;
}

/** Does this word of the text stand for the (misspelt) search word — whole, or as its start? */
function wordIsFuzzyMatch(word: string, term: string) {
  const max = fuzzyThreshold(term.length);
  if (max === 0) return false;
  if (Math.abs(word.length - term.length) <= max && osaDistance(word, term) <= max) return true;
  return word.length > term.length && osaDistance(word.slice(0, term.length), term) <= max;
}

/** The text folded for matching, with each folded character's original index. */
function foldWithIndex(text: string): { folded: string; index: number[] } {
  let folded = "";
  const index: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    // Char by char, so an index here is an index in the original text.
    const ch = text[i].toLowerCase()[0] ?? text[i];
    if (SKIPPED.test(ch)) continue;
    // 1,000 → 1000, 050-632 → 050632, 23/6 → 236: one separator between two digits
    if (DIGIT_SEPARATOR.test(ch) && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) continue;
    const mapped = FINALS[ch] ?? ch;
    folded += WORD_CHAR.test(mapped) ? mapped : " ";
    index.push(i);
  }
  return { folded, index };
}

function foldTerm(term: string): string {
  return foldWithIndex(term).folded.replace(/\s+/g, " ").trim();
}

/** Ranges [start, end) in `text` covered by any of the terms (merged). */
export function matchRanges(text: string, terms: string | readonly string[]): Array<[number, number]> {
  if (!text) return [];
  const list = (typeof terms === "string" ? [terms] : terms).filter((term) => term.trim().length > 0);
  if (list.length === 0) return [];
  const { folded, index } = foldWithIndex(text);
  const ranges: Array<[number, number]> = [];
  const paint = (part: string) => {
    if (!part) return false;
    let found = false;
    let from = folded.indexOf(part);
    while (from !== -1) {
      found = true;
      ranges.push([index[from], index[from + part.length - 1] + 1]);
      from = folded.indexOf(part, from + part.length);
    }
    return found;
  };
  // A word of the text that a misspelt search word stands for ("ביאן" for "באין").
  const paintFuzzy = (part: string) => {
    if (part.length < 3 || /\d/.test(part)) return;
    for (const word of folded.matchAll(/[^ ]+/g)) {
      const start = word.index ?? 0;
      if (wordIsFuzzyMatch(word[0], part)) ranges.push([index[start], index[start + word[0].length - 1] + 1]);
    }
  };
  for (const raw of list) {
    // Whole where it appears whole ("14:30", "משה כהן", "236" inside a phone).
    const whole = foldTerm(raw);
    if (!whole || paint(whole)) continue;
    // An hour is never split into "14" and "30".
    if (/^\s*\d{1,2}:\d{2}\s*$/.test(raw)) continue;
    // Otherwise piece by piece, as the quick search matched it: "משה כהן"
    // lights both words apart, "23/6" lights the 23 and the 6 of a number.
    const parts = raw.split(TERM_PARTS).map(foldTerm).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) if (!paint(part)) paintFuzzy(part);
    } else {
      paintFuzzy(whole);
    }
  }
  ranges.sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** `text` with every match of the terms wrapped in a yellow <mark>. */
export function highlightText(text: string, terms: string | readonly string[]): ReactNode {
  const ranges = matchRanges(text, terms);
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], key) => {
    if (start > at) parts.push(<Fragment key={`t${key}`}>{text.slice(at, start)}</Fragment>);
    parts.push(
      <mark key={`m${key}`} className={MARK_CLASS}>
        {text.slice(start, end)}
      </mark>
    );
    at = end;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return parts;
}

/** A whole value painted (a matched date, amount or phone). */
export function HighlightAll({ children }: { children: ReactNode }) {
  return <mark className={MARK_CLASS}>{children}</mark>;
}

/**
 * A long text cut to a window around its first match, so the yellow part is
 * on screen even in a long note ("…ביאנקו נרו 1700 מול…").
 */
export function snippetAround(text: string, terms: string | readonly string[], max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const first = matchRanges(clean, terms)[0];
  if (!first) return `${clean.slice(0, max - 1)}…`;
  const pad = Math.max(0, Math.floor((max - (first[1] - first[0])) / 2));
  const start = Math.max(0, Math.min(first[0] - pad, clean.length - max));
  const end = Math.min(clean.length, start + max);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

/** The "why it matched" line: a short field label + the matching text, painted. */
export function MatchReason({
  label,
  value,
  terms,
  whole = false,
  className,
}: {
  label: string;
  value: string;
  terms: string | readonly string[];
  /** Paint the whole value (a date / amount / phone that matched as such). */
  whole?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="font-medium">{label}:</span>{" "}
      {whole ? <HighlightAll>{value}</HighlightAll> : highlightText(snippetAround(value, terms), terms)}
    </div>
  );
}
