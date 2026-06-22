/**
 * Shared customer-search matching used by every customer-finding surface:
 * the `/api/customers/search` route (new-customer dup check, the order & project
 * create/edit wizards, the customers page, collections), the orders & projects
 * list loaders, and the global search. The behaviour is identical everywhere —
 * the global search only layers extra entity types on top.
 *
 * Matching rules:
 * - Hebrew-aware normalization: drops niqqud + punctuation and folds final
 *   letters (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ) so spelling/keyboard variants collapse.
 * - Names match by substring OR fuzzy (typo / adjacent letter-swap tolerant),
 *   so typing "באין" still finds "ביאן".
 * - Phone & WhatsApp are compared digit-only and CROSS-checked: a queried
 *   number is matched against BOTH the phone and the whatsapp field, and the
 *   Israeli country code (+972 / 00972) folds to the local 0-prefixed form.
 */

const HEBREW_FINAL_LETTERS: Array<[RegExp, string]> = [
  [/ך/g, "כ"],
  [/ם/g, "מ"],
  [/ן/g, "נ"],
  [/ף/g, "פ"],
  [/ץ/g, "צ"],
];

/** Normalize free text for comparison (Hebrew-aware, case/punctuation-insensitive). */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return "";
  let out = value
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[״"'`´.,/\\|()[\]{}\-–—_:;!?+=*&^%$#@~<>]/g, " ");
  for (const [pattern, replacement] of HEBREW_FINAL_LETTERS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Reduce a phone/whatsapp value to comparable digits (folds the +972 prefix). */
export function normalizePhone(value: string | null | undefined): string {
  if (!value) return "";
  let digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  digits = digits.replace(/^00/, "");
  if (digits.startsWith("972")) {
    digits = "0" + digits.slice(3);
  }
  return digits;
}

/**
 * Optimal string alignment (Damerau–Levenshtein restricted to adjacent
 * transpositions) — enough to treat a single letter swap, insert, delete or
 * substitution as "close enough".
 */
export function osaDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

/** Edits tolerated for a token of the given length when matching similar names. */
function fuzzyThreshold(length: number): number {
  if (length <= 2) return 0;
  if (length <= 4) return 1;
  if (length <= 7) return 2;
  return 3;
}

function tokenFuzzyMatch(haystackToken: string, queryToken: string): boolean {
  if (!haystackToken || !queryToken) return false;
  if (haystackToken.includes(queryToken)) return true;
  const threshold = fuzzyThreshold(queryToken.length);
  if (threshold === 0) return false;
  if (Math.abs(haystackToken.length - queryToken.length) > threshold) return false;
  return osaDistance(haystackToken, queryToken) <= threshold;
}

/**
 * Fuzzy text match: true when `query` is a substring of `haystack`, or when
 * every query word is within edit-distance of some haystack word. Used for
 * names so misspellings/letter swaps still match.
 */
export function fuzzyTextMatch(haystack: string | null | undefined, query: string): boolean {
  const nq = normalizeSearchText(query);
  if (!nq) return false;
  const nh = normalizeSearchText(haystack);
  if (!nh) return false;
  if (nh.includes(nq)) return true;

  const queryTokens = nq.split(" ").filter(Boolean);
  const haystackTokens = nh.split(" ").filter(Boolean);
  if (queryTokens.length === 0 || haystackTokens.length === 0) return false;

  return queryTokens.every((queryToken) =>
    haystackTokens.some((haystackToken) => tokenFuzzyMatch(haystackToken, queryToken))
  );
}

/** Plain normalized substring match (no fuzziness) — for emails, addresses, ids. */
export function substringMatch(haystack: string | null | undefined, query: string): boolean {
  const nq = normalizeSearchText(query);
  if (!nq) return false;
  return normalizeSearchText(haystack).includes(nq);
}

/**
 * Digit-only phone match across any number of fields. Passing both the phone
 * and whatsapp values cross-checks the query against both columns.
 */
export function phoneMatchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const queryDigits = normalizePhone(query);
  if (queryDigits.length < 3) return false;
  return values.some((value) => {
    const digits = normalizePhone(value);
    return digits.length > 0 && digits.includes(queryDigits);
  });
}

export type CustomerSearchContact = {
  full_name?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
};

export type CustomerSearchFields = {
  name?: string | null;
  name_for_invoice?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  registration_number?: string | null;
  contacts?: CustomerSearchContact[] | null;
};

/** Does this customer (and its contacts) match the query? */
export function customerMatchesQuery(fields: CustomerSearchFields, query: string): boolean {
  if (!query.trim()) return false;

  if (
    fuzzyTextMatch(fields.name, query) ||
    fuzzyTextMatch(fields.name_for_invoice, query) ||
    substringMatch(fields.email, query) ||
    substringMatch(fields.address, query) ||
    substringMatch(fields.registration_number, query) ||
    phoneMatchesQuery([fields.phone, fields.whatsapp], query)
  ) {
    return true;
  }

  for (const contact of fields.contacts ?? []) {
    if (!contact) continue;
    if (
      fuzzyTextMatch(contact.full_name, query) ||
      substringMatch(contact.email, query) ||
      phoneMatchesQuery([contact.phone, contact.whatsapp], query)
    ) {
      return true;
    }
  }

  return false;
}

/** Relevance score for ranking matches — lower is better. */
export function customerMatchScore(fields: CustomerSearchFields, query: string): number {
  const nq = normalizeSearchText(query);
  const name = normalizeSearchText(fields.name) || normalizeSearchText(fields.name_for_invoice);
  if (name && nq) {
    if (name === nq) return 0;
    if (name.startsWith(nq)) return 1;
    if (name.includes(nq)) return 2;
  }
  if (phoneMatchesQuery([fields.phone, fields.whatsapp], query)) return 3;
  if (fuzzyTextMatch(fields.name, query) || fuzzyTextMatch(fields.name_for_invoice, query)) return 4;
  return 5;
}
