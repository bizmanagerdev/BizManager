// Reading a US credit-card statement — Chase (Sapphire) and Capital One
// (Venture X) — for a card kept as its own account (owner, 2026-10-25: "each US
// card its own account, payments to it as transfers").
//
// A US card is paid any amount on any day, from Chase or Capital One, and
// carries a balance — so its statement is read as an account's statement:
// every line moves what we owe the card, and the lines must take the previous
// balance to the new one, to the cent. Pure and framework-free: the import
// screen feeds it the text lines of the PDF (lib/financial/pdfStatement.ts) or
// the rows of the bank's CSV download.
//
// Signs, as the card's balance sees them: a purchase, fee, interest or cash
// advance is + (we owe more); a payment or a refund is − (we owe less).

export type UsCardIssuer = "chase" | "capital_one";

/** charge = a purchase, fee or interest (negative: a refund or credit);
 *  payment = paying the card; cash_advance = cash taken on the card. */
export type UsLineKind = "charge" | "payment" | "cash_advance";

export type UsSection = "payments_credits" | "purchases" | "cash_advances" | "fees" | "interest";

export type UsStatementLine = {
  /** The day the line counts on the card — Capital One's post date; Chase
   *  prints one date only. */
  postDate: string;
  /** The day of the purchase (the same as postDate when the file has one date). */
  txnDate: string;
  description: string;
  /** In dollars: + we owe more, − we owe less. */
  amount: number;
  kind: UsLineKind;
  section: UsSection;
  /** The card the line was made on (an authorized user's has its own number). */
  cardLast4: string | null;
  cardholder: string | null;
  /** Lines printed under it: a foreign amount and its rate, a ticket number. */
  detail: string | null;
};

/** What the statement prints in its summary box, each as a positive amount. */
export type UsStatementSummary = {
  payments: number | null;
  /** Capital One prints refunds apart from payments; Chase prints them together
   *  (then this is null and `payments` holds both). */
  otherCredits: number | null;
  purchases: number | null;
  cashAdvances: number | null;
  fees: number | null;
  interest: number | null;
};

export type UsStatement = {
  issuer: UsCardIssuer;
  /** "Venture X", "Sapphire" — for the card's label. */
  cardName: string;
  /** The account's last 4 digits, as the statement names it. */
  cardLast4: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  previousBalance: number | null;
  newBalance: number | null;
  summary: UsStatementSummary;
  lines: UsStatementLine[];
  /** "pdf" carries the summary; a CSV download doesn't. */
  source: "pdf" | "csv";
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// An amount as the statements print it — Chase drops the leading zero (".67").
const AMOUNT = String.raw`(?:\d[\d,]*)?\.\d{2}`;

/** "$1,234.56", "- $4.50", "-4,616.87", "+$15,666.89", ".67" → a number (NaN when none). */
export function parseUsAmount(raw: string): number {
  const s = String(raw ?? "").trim();
  const m = s.match(new RegExp(String.raw`^([+\-−]?)\s*\$?\s*([+\-−]?)\s*(${AMOUNT})$`));
  if (!m) return NaN;
  const value = Number(m[3].replace(/,/g, ""));
  const negative = [m[1], m[2]].some((x) => x === "-" || x === "−");
  return negative ? -value : value;
}

/** The year a month/day line belongs to: the one that puts it nearest the
 *  statement's period (a December line on a January statement is last year's). */
function yearFor(month: number, day: number, periodEnd: string | null, fallbackYear: number): number {
  if (!periodEnd) return fallbackYear;
  const end = Date.parse(periodEnd);
  const endYear = Number(periodEnd.slice(0, 4));
  let best = endYear;
  let bestGap = Infinity;
  for (const y of [endYear - 1, endYear, endYear + 1]) {
    const gap = Math.abs(Date.parse(iso(y, month, day)) - end);
    if (gap < bestGap) {
      bestGap = gap;
      best = y;
    }
  }
  return best;
}

function isPaymentDescription(description: string): boolean {
  return /\b(PYMT|PAYMENT|AUTOPAY|THANK YOU)\b/i.test(description);
}

function joinedText(lines: string[]): string {
  return lines.map((l) => String(l ?? "")).join("\n");
}

function amountAfter(text: string, label: RegExp): number | null {
  const m = text.match(new RegExp(label.source + String.raw`\s*([=+\-−]?\s*\$?\s*[+\-−]?\s*${AMOUNT})`));
  if (!m) return null;
  const v = parseUsAmount(m[1].replace(/^=\s*/, ""));
  return Number.isFinite(v) ? Math.abs(v) : null;
}

// ── Capital One (Venture X) ──────────────────────────────────────────────────

const C1_TXN = new RegExp(String.raw`^([A-Z][a-z]{2}) (\d{1,2}) ([A-Z][a-z]{2}) (\d{1,2}) (.+?) ([+\-−]?\s*\$\s*${AMOUNT})$`);
const C1_NOISE = [
  /^Page \d+ of \d+$/,
  /Card \| .* ending in \d{4}$/,
  /\| \d+ days in Billing Cycle$/,
  /^Transactions( \(Continued\))?$/,
  /^Trans Date Post Date Description Amount$/,
  /^Additional Information on the next page$/,
  /^Visit capitalone\.com/,
  /^--- page \d+ end$/,
];

function parseCapitalOne(lines: string[]): UsStatement | null {
  const text = joinedText(lines);
  const card = text.match(/^(.+?) Card \| .*? ending in (\d{4})$/m);
  const period = text.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) \| \d+ days in Billing Cycle/m);
  if (!card || !period) return null;
  const monthOf = (name: string) => MONTHS[name.slice(0, 3).toLowerCase()] ?? 0;
  const periodStart = iso(Number(period[3]), monthOf(period[1]), Number(period[2]));
  const periodEnd = iso(Number(period[6]), monthOf(period[4]), Number(period[5]));
  const due = text.match(/Payment Due Date: ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);

  const summary: UsStatementSummary = {
    payments: amountAfter(text, /\bPayments/),
    otherCredits: amountAfter(text, /\bOther Credits/),
    purchases: amountAfter(text, /\bTransactions/),
    cashAdvances: amountAfter(text, /\bCash Advances/),
    fees: amountAfter(text, /\bFees Charged/),
    interest: amountAfter(text, /\bInterest Charged/),
  };

  const out: UsStatementLine[] = [];
  let section: UsSection | null = null;
  let holder: { name: string; last4: string } | null = null;
  let last: UsStatementLine | null = null;
  const details: string[][] = [];
  const fallbackYear = Number(periodEnd.slice(0, 4));

  for (const raw of lines) {
    const line = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const head = line.match(/^(.+?) #(\d{4}): (Payments, Credits and Adjustments|Transactions|Total Transactions)\b/);
    if (head) {
      holder = { name: head[1].trim(), last4: head[2] };
      section = head[3] === "Total Transactions" ? null : head[3].startsWith("Payments") ? "payments_credits" : "purchases";
      last = null;
      continue;
    }
    if (/^Total Transactions for This Period/.test(line)) {
      section = null;
      last = null;
      continue;
    }
    if (line === "Fees") {
      section = "fees";
      last = null;
      continue;
    }
    if (line === "Interest Charged") {
      section = "interest";
      last = null;
      continue;
    }
    if (/^Total (Fees|Interest) for This Period/.test(line) || /^Totals Year-to-Date/.test(line)) {
      section = null;
      last = null;
      continue;
    }
    if (!section) continue;
    if (C1_NOISE.some((re) => re.test(line))) continue;

    if (section === "interest") {
      // "Interest Charge on Purchases $12.34" — no dates; it posts on the closing day.
      const m = line.match(new RegExp(String.raw`^(Interest Charge on .+?) (\$\s*${AMOUNT})$`));
      const amount = m ? parseUsAmount(m[2]) : NaN;
      if (m && amount > 0) {
        out.push({
          postDate: periodEnd, txnDate: periodEnd, description: m[1], amount, kind: "charge",
          section, cardLast4: card[2], cardholder: null, detail: null,
        });
        details.push([]);
      }
      continue;
    }

    const t = line.match(C1_TXN);
    if (t) {
      const amount = parseUsAmount(t[6]);
      if (!Number.isFinite(amount)) continue;
      const tm = monthOf(t[1]);
      const pm = monthOf(t[3]);
      const txnDate = iso(yearFor(tm, Number(t[2]), periodEnd, fallbackYear), tm, Number(t[2]));
      const postDate = iso(yearFor(pm, Number(t[4]), periodEnd, fallbackYear), pm, Number(t[4]));
      const description = t[5].trim();
      const signed = section === "payments_credits" ? -Math.abs(amount) : amount;
      last = {
        postDate, txnDate, description, amount: signed,
        kind: section === "payments_credits" && isPaymentDescription(description) ? "payment" : "charge",
        section,
        cardLast4: section === "fees" ? card[2] : holder?.last4 ?? card[2],
        cardholder: section === "fees" ? null : holder?.name ?? null,
        detail: null,
      };
      out.push(last);
      details.push([]);
      continue;
    }
    // A line under a transaction: its foreign amount, rate, ticket.
    if (last) details[details.length - 1].push(line);
  }
  out.forEach((l, i) => {
    l.detail = details[i].length ? details[i].join(" · ").slice(0, 300) : null;
  });

  return {
    issuer: "capital_one",
    cardName: card[1].trim(),
    cardLast4: card[2],
    periodStart,
    periodEnd,
    dueDate: due ? iso(Number(due[3]), monthOf(due[1]), Number(due[2])) : null,
    previousBalance: amountAfter(text, /\bPrevious Balance/),
    newBalance: amountAfter(text, /\bNew Balance =/) ?? amountAfter(text, /\bNew Balance/),
    summary,
    lines: out,
    source: "pdf",
  };
}

// ── Chase (Sapphire) ─────────────────────────────────────────────────────────

const CHASE_TXN = new RegExp(String.raw`^(\d{2})\/(\d{2}) (.+?) (-?${AMOUNT})$`);
// Bold headings come out doubled ("ACCOUNT ACCOUNT ACTIVITY ACTIVITY").
const CHASE_ACTIVITY = /^ACCOUNT (ACCOUNT )?ACTIVITY( ACTIVITY)?( \(CONTINUED\))?$/;

function chaseSection(line: string): UsSection | "end" | null {
  if (line === "PAYMENTS AND OTHER CREDITS") return "payments_credits";
  if (line === "PURCHASE" || line === "PURCHASES") return "purchases";
  if (line === "CASH ADVANCES" || line === "CASH ADVANCE") return "cash_advances";
  if (line === "FEES CHARGED") return "fees";
  if (line === "INTEREST CHARGED") return "interest";
  if (line === "BALANCE TRANSFERS") return "purchases";
  if (/^\d{4} Totals Year-to-Date$/.test(line) || /^INTEREST (INTEREST )?CHARGES/.test(line)) return "end";
  return null;
}

function parseChase(lines: string[]): UsStatement | null {
  const text = joinedText(lines);
  const period = text.match(/Opening\/Closing Date (\d{2})\/(\d{2})\/(\d{2}) - (\d{2})\/(\d{2})\/(\d{2})/);
  if (!period || !lines.some((l) => CHASE_ACTIVITY.test(String(l ?? "").trim()))) return null;
  const y2 = (yy: string) => 2000 + Number(yy);
  const periodStart = iso(y2(period[3]), Number(period[1]), Number(period[2]));
  const periodEnd = iso(y2(period[6]), Number(period[4]), Number(period[5]));
  const due = text.match(/Payment Due Date: (\d{2})\/(\d{2})\/(\d{2})/);
  const acct = text.match(/Account Number: [X\d ]*?(\d{4})\b/);
  const name = /sapphire/i.test(text) ? "Sapphire" : /freedom/i.test(text) ? "Freedom" : "Chase";

  const out: UsStatementLine[] = [];
  const details: string[][] = [];
  let inActivity = false;
  let section: UsSection | null = null;
  let last: UsStatementLine | null = null;
  const fallbackYear = Number(periodEnd.slice(0, 4));

  for (const raw of lines) {
    const line = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (CHASE_ACTIVITY.test(line)) {
      inActivity = true;
      continue;
    }
    if (!inActivity) continue;
    const s = chaseSection(line);
    if (s === "end") break;
    if (s) {
      section = s;
      last = null;
      continue;
    }
    if (!section) continue;
    const t = line.match(CHASE_TXN);
    if (t) {
      const amount = parseUsAmount(t[4]);
      if (!Number.isFinite(amount)) continue;
      const month = Number(t[1]);
      const day = Number(t[2]);
      const date = iso(yearFor(month, day, periodEnd, fallbackYear), month, day);
      const description = t[3].trim();
      last = {
        postDate: date,
        txnDate: date,
        description,
        amount,
        kind:
          section === "cash_advances"
            ? "cash_advance"
            : section === "payments_credits" && amount < 0 && isPaymentDescription(description)
              ? "payment"
              : "charge",
        section,
        cardLast4: acct?.[1] ?? null,
        cardholder: null,
        detail: null,
      };
      out.push(last);
      details.push([]);
      continue;
    }
    // Page furniture between pages of activity.
    if (/Page \d+ of \d+/.test(line) || /^Date of$|^Transaction$|^Merchant Name or Transaction Description/.test(line)) continue;
    if (/^TOTAL (FEES|INTEREST) FOR THIS PERIOD/.test(line)) {
      last = null;
      continue;
    }
    // "08/02 SHEQEL" + "21.00 X 0.328 (EXCHG RATE)", "081326 1 S TLV JFK"
    if (last && line.length < 120 && !/^\d{7} [A-Z]{3}\d+/.test(line)) details[details.length - 1].push(line);
  }
  out.forEach((l, i) => {
    l.detail = details[i].length ? details[i].join(" · ").slice(0, 300) : null;
  });

  return {
    issuer: "chase",
    cardName: name,
    cardLast4: acct?.[1] ?? null,
    periodStart,
    periodEnd,
    dueDate: due ? iso(y2(due[3]), Number(due[1]), Number(due[2])) : null,
    previousBalance: amountAfter(text, /\bPrevious Balance/),
    newBalance: amountAfter(text, /\bNew Balance/),
    summary: {
      payments: amountAfter(text, /\bPayment, Credits/),
      otherCredits: null,
      purchases: amountAfter(text, /\bPurchases/),
      cashAdvances: amountAfter(text, /\bCash Advances/),
      fees: amountAfter(text, /\bFees Charged/),
      interest: amountAfter(text, /\bInterest Charged/),
    },
    lines: out,
    source: "pdf",
  };
}

/** A US card statement's text lines (from its PDF) → the statement, or null
 *  when it isn't one this reader knows. */
export function parseUsCardStatementLines(lines: string[]): UsStatement | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return parseCapitalOne(lines) ?? parseChase(lines);
}

// ── CSV downloads ────────────────────────────────────────────────────────────

function usDateToIso(raw: string): string | null {
  const s = String(raw ?? "").trim();
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const year = mdy[3].length === 2 ? 2000 + Number(mdy[3]) : Number(mdy[3]);
    return iso(year, Number(mdy[1]), Number(mdy[2]));
  }
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
}

const headerIndex = (header: string[], name: string) =>
  header.findIndex((h) => String(h ?? "").trim().toLowerCase() === name.toLowerCase());

/**
 * The card's CSV download → the statement's lines (no summary — a CSV has
 * none, so the check is the card's balance against the statement's). Knows
 * Chase's ("Transaction Date, Post Date, Description, Category, Type, Amount,
 * Memo": a purchase is −) and Capital One's ("Transaction Date, Posted Date,
 * Card No., Description, Category, Debit, Credit"). Null for any other file.
 */
export function parseUsCardCsv(rows: string[][]): UsStatement | null {
  const headerRow = rows.findIndex((r) => headerIndex(r, "Transaction Date") !== -1 && headerIndex(r, "Description") !== -1);
  if (headerRow === -1) return null;
  const header = rows[headerRow];
  const col = (name: string) => headerIndex(header, name);
  const isChase = col("Post Date") !== -1 && col("Amount") !== -1 && col("Type") !== -1;
  const isCapitalOne = col("Posted Date") !== -1 && col("Debit") !== -1 && col("Credit") !== -1;
  if (!isChase && !isCapitalOne) return null;

  const out: UsStatementLine[] = [];
  for (const r of rows.slice(headerRow + 1)) {
    const cell = (name: string) => String(r[col(name)] ?? "").trim();
    const txnDate = usDateToIso(cell("Transaction Date"));
    const postDate = usDateToIso(cell(isChase ? "Post Date" : "Posted Date")) ?? txnDate;
    const description = cell("Description");
    if (!txnDate || !postDate || !description) continue;
    let amount: number;
    let kind: UsLineKind = "charge";
    let section: UsSection = "purchases";
    if (isChase) {
      const value = Number(cell("Amount").replace(/[$,]/g, ""));
      if (!Number.isFinite(value) || value === 0) continue;
      amount = -value; // Chase's download: a purchase is −, a payment +.
      const type = cell("Type").toLowerCase();
      if (type === "payment") {
        kind = "payment";
        section = "payments_credits";
      } else if (amount < 0) section = "payments_credits";
      else if (type === "fee") section = /interest/i.test(description) ? "interest" : "fees";
    } else {
      const debit = Number(cell("Debit").replace(/[$,]/g, "")) || 0;
      const credit = Number(cell("Credit").replace(/[$,]/g, "")) || 0;
      amount = debit - credit;
      if (amount === 0) continue;
      if (amount < 0) {
        section = "payments_credits";
        if (isPaymentDescription(description)) kind = "payment";
      } else if (/MEMBER FEE|ANNUAL FEE|\bFEE\b/i.test(description)) section = "fees";
      else if (/INTEREST CHARGE/i.test(description)) section = "interest";
    }
    out.push({
      postDate,
      txnDate,
      description,
      amount: fromCents(cents(amount)),
      kind,
      section,
      cardLast4: isCapitalOne ? cell("Card No.").replace(/\D/g, "").slice(-4) || null : null,
      cardholder: null,
      detail: null,
    });
  }
  if (out.length === 0) return null;
  const dates = out.map((l) => l.postDate).sort();
  return {
    issuer: isChase ? "chase" : "capital_one",
    cardName: isChase ? "Chase" : "Capital One",
    cardLast4: null,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    dueDate: null,
    previousBalance: null,
    newBalance: null,
    summary: { payments: null, otherCredits: null, purchases: null, cashAdvances: null, fees: null, interest: null },
    lines: out,
    source: "csv",
  };
}

// ── The check: do the lines add up to the statement? ─────────────────────────

export type UsCheckRow = { label: string; printed: number; read: number; ok: boolean };

export type UsStatementCheck = {
  /** False when the statement prints no summary (a CSV) — nothing to check against. */
  available: boolean;
  ok: boolean;
  /** New balance − (previous balance + every line), in dollars; 0 when it adds up. */
  difference: number;
  rows: UsCheckRow[];
};

/** Every line read must take the previous balance to the new one, and each
 *  part of the summary must match the lines under it. */
export function checkUsStatement(s: UsStatement): UsStatementCheck {
  if (s.previousBalance == null || s.newBalance == null) {
    return { available: false, ok: true, difference: 0, rows: [] };
  }
  const sum = (pred: (l: UsStatementLine) => boolean) =>
    s.lines.filter(pred).reduce((acc, l) => acc + cents(l.amount), 0);
  const rows: UsCheckRow[] = [];
  const add = (label: string, printed: number | null, readCents: number) => {
    if (printed == null) return;
    const read = fromCents(Math.abs(readCents));
    rows.push({ label, printed, read, ok: cents(printed) === Math.abs(readCents) });
  };
  if (s.summary.otherCredits != null) {
    add("תשלומים", s.summary.payments, sum((l) => l.kind === "payment"));
    add("זיכויים", s.summary.otherCredits, sum((l) => l.kind !== "payment" && l.amount < 0));
  } else {
    add("תשלומים וזיכויים", s.summary.payments, sum((l) => l.amount < 0));
  }
  add("קניות", s.summary.purchases, sum((l) => l.section === "purchases" && l.amount > 0));
  add("משיכות מזומן", s.summary.cashAdvances, sum((l) => l.section === "cash_advances"));
  add("עמלות", s.summary.fees, sum((l) => l.section === "fees"));
  add("ריבית", s.summary.interest, sum((l) => l.section === "interest"));
  const total = cents(s.previousBalance) + sum(() => true);
  const difference = fromCents(cents(s.newBalance) - total);
  return { available: true, ok: difference === 0 && rows.every((r) => r.ok), difference, rows };
}
