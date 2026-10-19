import { osaDistance } from "@/lib/search/customerMatch";
import { israelDateKey } from "@/lib/timezone";

/**
 * Turns what was typed into the global search box into the tokens the database
 * search (public.global_search) matches — owner, 2026-10-18: "if I search an
 * amount of money I want all the expenses to come up … I put in a date,
 * anything that happened on that date … a phone number".
 *
 *   "1000" / "₪1,000" / "1000 ש״ח"   → an amount (also a whole number in text)
 *   "15/10", "15.10.26", "2026-10-15" → a date
 *   "054-893-3553", "+972 54 8933553" → a phone (digits, +972 folded to 0)
 *   anything else                     → words; every word must be found
 *
 * Words are normalised the way the database's vocabulary is (lower case, final
 * letters folded, quote marks and niqqud dropped), so a misspelt word can be
 * matched to a real one (fuzzyAlternatives).
 */

export type GlobalSearchToken = {
  /** What was typed first, then close spellings that exist in the system. */
  t?: string[];
  /** A number that must stand on its own in text (1000 ≠ 10000). */
  w?: boolean;
  /** An exact amount. */
  a?: number;
  /** A day, "YYYY-MM-DD". */
  d?: string;
  /** Phone digits (local form, 0-prefixed). */
  p?: string;
};

export type UnderstoodPart = { kind: "amount" | "date" | "phone"; value: string };

export type ParsedGlobalQuery = {
  tokens: GlobalSearchToken[];
  /** The plain words, normalised — the ones a spelling fix may be found for. */
  words: string[];
  /** Amounts / dates / phones recognised, for the "searching for" line. */
  understood: UnderstoodPart[];
};

/** At most this many amount/date/phone tokens are matched as such (the database's limit). */
export const MAX_SPECIAL_TOKENS = 3;

const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

/**
 * The search's one normal form — the same steps as global_search_vocab:
 * lower case, final letters folded, quote marks and niqqud dropped, anything
 * else that isn't a letter or a digit turned into a space.
 */
export function gsNorm(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (ch) => FINALS[ch] ?? ch)
    .replace(/["'`´׳״’‘]/g, "")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[^0-9a-zא-ת؀-ۿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Digits of a phone in local form: +972 / 00972 / 972 → 0. */
export function phoneDigits(value: string): string {
  let digits = value.replace(/\D/g, "");
  digits = digits.replace(/^00/, "");
  if (digits.startsWith("972") && digits.length >= 11) digits = `0${digits.slice(3)}`;
  return digits;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// Currency words only mean "this is an amount" — they aren't searched for.
const CURRENCY_WORD = /(^|\s)(ש["״׳'`]?ח|שקלים|שקל|nis|ils)(?=\s|$)/gi;
const PHONE_RUN = /(^|\s)(\+?\d[\d\s\-().]{6,}\d)(?=\s|$)/g;
const DATE_PART = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const AMOUNT_PART = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

/**
 * Split a typed query into tokens. `today` (YYYY-MM-DD, Israel) decides the
 * year of a date typed without one.
 */
export function parseGlobalQuery(raw: string, today: string = israelDateKey(new Date())): ParsedGlobalQuery {
  const tokens: GlobalSearchToken[] = [];
  const words: string[] = [];
  const understood: UnderstoodPart[] = [];
  let text = (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return { tokens, words, understood };

  const hasDigit = /\d/.test(text);
  if (hasDigit) text = text.replace(/₪/g, " ").replace(CURRENCY_WORD, "$1 ");

  // A phone typed with spaces or dashes inside it ("054 893 3553").
  text = text.replace(PHONE_RUN, (whole, lead: string, run: string) => {
    const digits = phoneDigits(run);
    const looksLikePhone = /[\s\-().+]/.test(run) && digits.length >= 9 && digits.length <= 12 && digits.startsWith("0");
    if (!looksLikePhone) return whole;
    tokens.push({ t: [digits], p: digits });
    understood.push({ kind: "phone", value: run.trim() });
    return `${lead} `;
  });

  const year = Number(today.slice(0, 4));
  for (const part of text.split(" ").filter(Boolean)) {
    // A date: 15/10, 15.10.26, 15-10-2026, 2026-10-15
    const iso = ISO_DATE.exec(part);
    const dmy = iso ? null : DATE_PART.exec(part);
    if (iso || dmy) {
      const day = Number(iso ? iso[3] : dmy![1]);
      const month = Number(iso ? iso[2] : dmy![2]);
      const yRaw = iso ? iso[1] : dmy![3];
      const y = yRaw ? (yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw)) : year;
      const date = validDate(y, month, day);
      if (date) {
        const token: GlobalSearchToken = { d: date };
        // "1.5" is also one and a half shekels.
        if (dmy && !dmy[3] && part.includes(".")) token.a = Number(part);
        tokens.push(token);
        understood.push({ kind: "date", value: date });
        continue;
      }
    }

    // A number: an amount, or the start of a phone / ID / plate / account.
    const amount = AMOUNT_PART.exec(part);
    if (amount) {
      const intDigits = amount[1].replace(/,/g, "");
      const decimals = amount[2];
      if (intDigits.length > 1 && intDigits.startsWith("0") && !decimals) {
        // 050, 0548933553 — not an amount.
        tokens.push({ t: [intDigits], p: intDigits.length >= 3 ? intDigits : undefined });
        if (intDigits.length >= 9) understood.push({ kind: "phone", value: intDigits });
        continue;
      }
      const value = Number(decimals ? `${intDigits}.${decimals}` : intDigits);
      if (Number.isFinite(value)) {
        const token: GlobalSearchToken = { a: value, w: true };
        if (!decimals) token.t = [intDigits];
        // Five digits and up may also be part of a phone, plate or account number.
        if (!decimals && intDigits.length >= 5) token.p = intDigits;
        tokens.push(token);
        understood.push({ kind: "amount", value: String(value) });
        continue;
      }
    }

    // Words.
    for (const word of gsNorm(part).split(" ").filter(Boolean)) {
      tokens.push({ t: [word] });
      words.push(word);
    }
  }

  // One-letter words say nothing on their own, unless that's all there is.
  const meaningful = tokens.filter((token) => !(token.t && token.t[0].length < 2 && token.a === undefined && !token.d && !token.p));
  const kept = meaningful.length > 0 ? meaningful : tokens;

  // The database matches the first three amounts/dates/phones as such; any more
  // are looked for as numbers in text.
  let special = 0;
  const final = kept.map((token) => {
    const isSpecial = token.a !== undefined || token.d !== undefined || token.p !== undefined;
    if (!isSpecial) return token;
    special += 1;
    if (special <= MAX_SPECIAL_TOKENS) return token;
    return token.t ? { t: token.t, w: token.w } : null;
  }).filter((token): token is GlobalSearchToken => token !== null);

  return {
    tokens: final,
    words: words.filter((word) => kept.some((token) => token.t?.[0] === word)),
    understood,
  };
}

/**
 * The words the search's own labels put on records (statuses, payment methods,
 * kinds of record) — not in the database's vocabulary, but searchable ("שולם",
 * "פעיל", "צ׳ק"), so they must never be "corrected" to something else.
 */
export const LABEL_WORDS: readonly string[] = Array.from(
  new Set(
    [
      "הצעת מחיר מתוכנן פעיל בהמתנה הושלם בוטל הובלה שיפוצים לוגיסטיקה בית",
      "לביצוע בתהליך חסום בוצע נמוכה בינונית גבוהה דחופה",
      "פתוח פתוחה בהזמנה סופק חלקית נמסר נמסרה סגור סגורה שולם לא שולם יתר",
      "מזומן העברה בנקאית כרטיס אשראי צ׳ק ביט אחר זיכוי בכרטיס הועבר דרך חבר",
      "תשלום צפוי ממתין התקבל נפרע נדחה חזר שוטף ניהול נכסים מכירות פרויקטים צדקה ספייסיט",
      "ממתין לאישור אושר היעדרות מנהל משרד עובד ללא גישה שכר שעתי חודשי",
      "רכב קמפיין ציוד אירוע ספק תגית שיחה טלפון וואטסאפ אימייל",
      "הלוואה שקיבלנו שנתנו החזר בנק קופה חיוב דף הוצאה קבועה משימה ישיבה חוזה שכירות הבטחת",
    ]
      .join(" ")
      .split(" ")
      .map(gsNorm)
      .filter((word) => word.length >= 3)
  )
);

/** Edits tolerated for a word of this length, when it appears nowhere as typed. */
function threshold(length: number) {
  if (length <= 5) return 1;
  if (length <= 8) return 2;
  return 3;
}

function sameLetters(a: string, b: string) {
  return a.length === b.length && [...a].sort().join("") === [...b].sort().join("");
}

/**
 * Close spellings of `word` that exist in the system (the vocabulary) —
 * "באין" → "ביאן". Kept strict, because every fix is searched for too:
 *  - the word is itself a word in the system → nothing;
 *  - it appears inside longer words ("באין" in "באינטרנט") → only the same
 *    letters in another order (the usual slip);
 *  - it appears nowhere → close words and starts of longer words (a half-typed
 *    word with a slip): up to 5 letters only a swapped or changed letter, longer
 *    words 2–3 edits.
 * Results found as typed always rank above these.
 */
export function fuzzyAlternatives(word: string, vocabulary: readonly string[], limit = 3): string[] {
  if (word.length < 3 || /^\d+$/.test(word)) return [];
  if (vocabulary.includes(word) || LABEL_WORDS.includes(word)) return [];
  const appearsInside =
    vocabulary.some((entry) => entry.includes(word)) || LABEL_WORDS.some((entry) => entry.includes(word));
  const max = appearsInside ? 2 : threshold(word.length);
  const scored = new Map<string, number>();
  for (const entry of vocabulary) {
    const candidates =
      !appearsInside && entry.length > word.length ? [entry, entry.slice(0, word.length)] : [entry];
    for (const candidate of candidates) {
      if (candidate === word || Math.abs(candidate.length - word.length) > max) continue;
      // Short words, and words that already exist inside others: the same
      // letters reordered, or (short words that exist nowhere) one letter
      // changed — never a letter added or dropped.
      if (appearsInside || word.length <= 3) {
        if (!sameLetters(candidate, word)) continue;
      } else if (word.length <= 5 && candidate.length !== word.length) {
        continue;
      }
      const distance = osaDistance(candidate, word);
      if (distance > max) continue;
      const previous = scored.get(candidate);
      if (previous === undefined || distance < previous) scored.set(candidate, distance);
    }
  }
  return [...scored.entries()]
    .sort((left, right) => left[1] - right[1] || Math.abs(left[0].length - word.length) - Math.abs(right[0].length - word.length) || left[0].localeCompare(right[0], "he"))
    .slice(0, limit)
    .map(([candidate]) => candidate);
}
