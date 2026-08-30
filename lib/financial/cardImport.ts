// Pure parsing + duplicate-detection helpers for the credit-card statement importer
// (app/financial/import). Kept framework-free so they can be unit tested and reused by
// the upcoming PDF parsing paths.

// An existing expense as returned by /api/expenses/check-duplicates. Credit-card imports
// store the billing date in expense_date and the real spend date in transaction_date;
// older rows (and manual entries) may only have expense_date.
export type ExistingExpense = {
  id?: string; // present when the match can be linked to the live expense
  expense_date: string;
  transaction_date?: string | null;
  amount: number;
  description: string;
};

// A statement row being considered for import. billingDate mirrors the saved expense_date
// (תאריך חיוב); txnDate is the transaction date (תאריך עסקה). Either may be "".
export type DuplicateInput = {
  amount: number;
  billingDate: string;
  txnDate: string;
  description: string;
};

// Remembered assignment for a merchant, keyed by normalized merchant name (norm()).
// category is only filled by the bank-statement screen (card imports set the card
// label as the category), so it stays optional for existing callers.
export type MerchantAssignment = {
  businessDomain: string;
  projectId: string;
  propertyId: string;
  category?: string;
};
export type MerchantMemory = Record<string, MerchantAssignment>;

// A normalized statement transaction — the shared shape produced by every parsing path
// (Excel, local pdfjs text, and the Claude PDF fallback) and consumed by the review step.
export type ParsedTxn = {
  billingDate: string; // ISO yyyy-mm-dd or "" (תאריך חיוב)
  txnDate: string; // ISO yyyy-mm-dd or "" (תאריך עסקה)
  amount: number; // ILS charge amount; negative for refunds/credits
  merchant: string;
  card: string; // card label / last 4 digits, "" if unknown
  currency?: string | null; // original currency code when foreign (e.g. "USD")
  originalAmount?: number | null; // amount in the original currency, when foreign
  installment?: string | null; // e.g. "2/6"
};

const MS_PER_DAY = 86_400_000;

export const norm = (s: unknown) =>
  String(s ?? "").replace(/["׳״'`]/g, "").replace(/\s+/g, " ").trim();

export const FALLBACK_CATEGORY = "כרטיס אשראי";

// Column-header phrase candidates, checked in order, for each parsed field.
export const FIELD_TOKENS = {
  date: ["תאריך חיוב", "מועד חיוב", "תאריך החיוב", "תאריך"],
  amount: ["סכום חיוב", "סכום החיוב", "סכום לחיוב", "סכום בשח", "סכום בש", "חיוב", "סכום"],
  merchant: ["שם בית עסק", "שם בית העסק", "בית עסק", "בית העסק", "תיאור עסקה", "תיאור", "שם"],
  txnDate: ["תאריך עסקה", "תאריך העסקה", "מועד עסקה"],
  assignment: ["שיוך", "שיוך עסקי", "קטגוריה", "תחום"],
} as const;

export function findColumn(header: string[], tokens: readonly string[]): number {
  for (const token of tokens) {
    const idx = header.findIndex((cell) => norm(cell).includes(token));
    if (idx !== -1) return idx;
  }
  return -1;
}

// A card-section title row, e.g. "חשבון כרטיס: 176606 שם כרטיס: ויזה כאל זהב ארבע ספרות אחרונות 9557".
export function extractCardName(rowCells: string[]): string | null {
  const joined = rowCells.map((c) => String(c ?? "")).join(" ").trim();
  if (!joined) return null;
  if (!/שם כרטיס|חשבון כרטיס|ספרות אחרונות/.test(joined)) return null;
  const last4 = joined.match(/(\d{4})\s*$/) ?? joined.match(/אחרונות\D*(\d{3,4})/);
  const digits = last4 ? last4[1] : "";
  const nameMatch = joined.match(/שם כרטיס[:\s]*(.*?)(?:ארבע ספרות|ספרות אחרונות|$)/);
  const name = nameMatch ? nameMatch[1].trim() : "";
  const label = [name, digits].filter(Boolean).join(" ").trim();
  return label || FALLBACK_CATEGORY;
}

/**
 * Which row of a parsed sheet is the real column-header row. Scores each row
 * (within the first 25) by how many FIELD_TOKENS categories it matches, and
 * skips any row that looks like a card-section divider ("חשבון כרטיס: … שם
 * כרטיס: …") — a divider must never be picked, or its own (mostly blank)
 * columns get treated as the header for date/amount/merchant, and the whole
 * mapping step shows every field as empty. Falls back to the first
 * non-divider row when nothing scores (instead of blindly defaulting to row
 * 0, which is often the divider itself).
 */
export function detectHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 25);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const header = rows[i] ?? [];
    if (extractCardName(header)) continue;
    if (best === -1) best = i;
    let score = 0;
    for (const tokens of Object.values(FIELD_TOKENS)) {
      if (findColumn(header, tokens) !== -1) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best === -1 ? 0 : best;
}

export function parseAmount(raw: unknown): number {
  if (typeof raw === "number") return raw;
  let s = String(raw ?? "").trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.includes("-")) neg = true;
  s = s.replace(/[^\d.]/g, "");
  if (!s) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

export function parseDateToIso(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (dmy[3].length === 2) year = year >= 70 ? 1900 + year : 2000 + year;
    // If DD-MM-YY gives an impossible month but swapping yields a valid one, try MM-DD-YY.
    // Handles bank exports that use MM-DD-YY format (e.g. 02-13-26 = February 13th).
    if ((month < 1 || month > 12) && day >= 1 && day <= 12) {
      [day, month] = [month, day];
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoTime(iso: unknown): number | null {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function minPairDistance(a: number[], b: number[]): number | null {
  let best: number | null = null;
  for (const x of a) {
    for (const y of b) {
      const d = Math.abs(x - y);
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

// Find an existing expense that looks like the same charge: same amount, and ANY of the
// row's dates (transaction or billing) lands within ±windowDays of ANY of the existing
// expense's dates (transaction or billing). This is the fix for the old asymmetry where
// imports save the billing date but dedup only compared the transaction date — re-imports
// and near-date matches were missed. Merchant-name overlap breaks ties.
export function findDuplicate(
  row: DuplicateInput,
  existing: ExistingExpense[],
  windowDays: number
): ExistingExpense | null {
  const rowDates = [row.txnDate, row.billingDate]
    .map(isoTime)
    .filter((t): t is number => t !== null);
  if (rowDates.length === 0) return null;

  const windowMs = windowDays * MS_PER_DAY;
  const merchant = norm(row.description);

  type Scored = { exp: ExistingExpense; dist: number; nameHit: number };
  const scored: Scored[] = [];

  for (const e of existing) {
    if (Math.abs((e.amount ?? 0) - row.amount) >= 0.01) continue;
    const existingDates = [e.expense_date, e.transaction_date]
      .map(isoTime)
      .filter((t): t is number => t !== null);
    if (existingDates.length === 0) continue;
    const dist = minPairDistance(rowDates, existingDates);
    if (dist === null || dist > windowMs) continue;
    const n = norm(e.description);
    const nameHit =
      merchant.length > 1 && n.length > 1 && (n.includes(merchant) || merchant.includes(n)) ? 0 : 1;
    scored.push({ exp: e, dist, nameHit });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => a.nameHit - b.nameHit || a.dist - b.dist);
  return scored[0].exp;
}

// ── Local PDF text heuristic ─────────────────────────────────────────────────
// Reconstructed PDF lines are messy and issuer-specific, so this is a best-effort
// pass: a line is a candidate transaction when it carries at least one date and one
// money amount. `confidence` (count of candidates) lets the caller decide whether to
// trust this or fall back to the Claude parser.

const DATE_TOKEN_RE = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/g;
// Amounts like 1,234.56 / 12.00 / 1234 — at least one digit, optional thousands/decimals.
const AMOUNT_TOKEN_RE = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+/g;

function isoFromDateMatch(m: RegExpMatchArray, fallbackYear: number): string | null {
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : fallbackYear;
  if (m[3] && m[3].length === 2) year = year >= 70 ? 1900 + year : 2000 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseStatementLines(
  lines: string[],
  fallbackYear: number = new Date().getFullYear()
): { txns: ParsedTxn[]; confidence: number } {
  const txns: ParsedTxn[] = [];

  for (const raw of lines) {
    const line = String(raw ?? "").replace(/‏|‎/g, "").trim();
    if (!line) continue;

    const dates = [...line.matchAll(DATE_TOKEN_RE)]
      .map((m) => isoFromDateMatch(m, fallbackYear))
      .filter((d): d is string => Boolean(d));
    if (dates.length === 0) continue;

    const amountStrs = [...line.matchAll(AMOUNT_TOKEN_RE)].map((m) => m[0]);
    // Drop pure integers that are really part of a date (e.g. "9557" card digits look
    // like amounts) by requiring at least one amount with a decimal part.
    const moneyStrs = amountStrs.filter((s) => /[.,]/.test(s));
    if (moneyStrs.length === 0) continue;

    const amount = parseAmount(moneyStrs[moneyStrs.length - 1]);
    if (!Number.isFinite(amount) || amount === 0) continue;

    // Two dates → [transaction, billing]; one date → transaction only.
    const txnDate = dates[0];
    const billingDate = dates.length > 1 ? dates[1] : "";

    // Merchant = whatever text remains once dates and amounts are stripped.
    let merchant = line;
    for (const d of [...line.matchAll(DATE_TOKEN_RE)].map((m) => m[0])) merchant = merchant.replace(d, " ");
    for (const a of amountStrs) merchant = merchant.replace(a, " ");
    merchant = merchant.replace(/[₪$€£%]/g, " ").replace(/\s+/g, " ").trim();
    if (merchant.length < 2) merchant = "ללא שם";

    // Only the Hebrew "X מתוך Y" form — the "X/Y" form collides with dd/mm dates.
    const installment = line.match(/(\d+)\s*מתוך\s*(\d+)/);
    const refund = /זיכוי|החזר/.test(line) || amount < 0;

    txns.push({
      billingDate,
      txnDate,
      amount: refund ? -Math.abs(amount) : amount,
      merchant,
      card: "",
      installment: installment ? `${installment[1]}/${installment[2]}` : null,
    });
  }

  return { txns, confidence: txns.length };
}
