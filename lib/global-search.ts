import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/requireProfile";
import { buildFocusHref } from "@/lib/audit";
import { formatDateWithTime, formatShortDate, formatShortDateTime, formatTimeOnly } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import {
  getOrderStatusLabel,
  getPaymentStatusLabel,
  getProjectStatusLabel,
  getTaskPriorityLabel,
  getTaskStatusLabel,
} from "@/lib/ui/status-colors";
import {
  fuzzyAlternatives,
  parseGlobalQuery,
  type GlobalSearchToken,
  type UnderstoodPart,
} from "@/lib/search/global-query";

// The global search (owner, 2026-10-18): one box that finds ANY record in the
// system — by a word in it (fuzzy), an amount, a date or a phone — and says
// why each one came up. The finding is one database call (public.global_search,
// see supabase/migrations/20261018140000_global_search.sql); this side turns
// the typed query into its tokens, adds close spellings for a misspelt word,
// and turns each row into a result with a link to the record itself.

export type GlobalSearchKind =
  | "customer"
  | "contact"
  | "project"
  | "order"
  | "task"
  | "payment"
  | "expense"
  | "document"
  | "vehicle"
  | "product"
  | "worker"
  | "worker_payment"
  | "shift"
  | "attendance_report"
  | "absence"
  | "salary"
  | "payslip"
  | "invoice"
  | "communication"
  | "reminder"
  | "loan"
  | "loan_repayment"
  | "transfer"
  | "account"
  | "card_row"
  | "card_charge"
  | "card_statement"
  | "recurring_expense"
  | "recurring_task"
  | "meeting"
  | "property"
  | "lease"
  | "promise";

/** Kept for callers that still name it by its old type name. */
export type GlobalSearchGroupKey = GlobalSearchKind;

/** In this order when two groups match equally well. */
export const GLOBAL_SEARCH_KINDS: GlobalSearchKind[] = [
  "customer",
  "contact",
  "project",
  "order",
  "task",
  "payment",
  "expense",
  "document",
  "vehicle",
  "product",
  "worker",
  "worker_payment",
  "shift",
  "attendance_report",
  "absence",
  "salary",
  "payslip",
  "invoice",
  "communication",
  "reminder",
  "loan",
  "loan_repayment",
  "transfer",
  "account",
  "card_row",
  "card_charge",
  "card_statement",
  "recurring_expense",
  "recurring_task",
  "meeting",
  "property",
  "lease",
  "promise",
];

export const GLOBAL_SEARCH_LABELS: Record<GlobalSearchKind, string> = {
  customer: "לקוחות",
  contact: "אנשי קשר",
  project: "פרויקטים",
  order: "הזמנות",
  task: "משימות",
  payment: "הכנסות",
  expense: "הוצאות",
  document: "מסמכים",
  vehicle: "רכבים ותגיות",
  product: "מוצרים",
  worker: "עובדים",
  worker_payment: "תשלומים לעובדים",
  shift: "משמרות",
  attendance_report: "דיווחי שעות בטלפון",
  absence: "היעדרויות",
  salary: "הסכמי שכר",
  payslip: "תלושים",
  invoice: "חשבוניות וקבלות",
  communication: "תיעוד תקשורת",
  reminder: "תזכורות",
  loan: "הלוואות",
  loan_repayment: "החזרי הלוואות",
  transfer: "העברות בין חשבונות",
  account: "חשבונות וקופה",
  card_row: "שורות אשראי",
  card_charge: "חיובי כרטיס",
  card_statement: "דפי חיוב אשראי",
  recurring_expense: "הוצאות קבועות",
  recurring_task: "משימות קבועות",
  meeting: "ישיבות",
  property: "נכסים",
  lease: "חוזי שכירות",
  promise: "הבטחות תשלום",
};

// The money ledger, loans and bank pages open for admins only, so office staff
// aren't shown records whose page they can't open.
const ADMIN_ONLY_KINDS: GlobalSearchKind[] = ["expense", "loan", "loan_repayment", "transfer", "account"];

export function kindsForRole(role: UserRole): GlobalSearchKind[] | null {
  if (role === "admin") return null;
  return GLOBAL_SEARCH_KINDS.filter((kind) => !ADMIN_ONLY_KINDS.includes(kind));
}

export function isGlobalSearchKind(value: unknown): value is GlobalSearchKind {
  return typeof value === "string" && (GLOBAL_SEARCH_KINDS as string[]).includes(value);
}

export type GlobalSearchReason = {
  kind: "date" | "amount" | "phone" | "text";
  label: string;
  /** Ready to show (a date as 15/10/26, an amount as ₪1,000). */
  value: string;
};

export type GlobalSearchMeta = { text: string; hit?: boolean };

export type GlobalSearchResult = {
  id: string;
  group: GlobalSearchKind;
  groupLabel: string;
  title: string;
  subtitle: string | null;
  meta: GlobalSearchMeta[];
  href: string;
  /** Why it came up — shown under the title, the matching part in yellow. */
  reasons: GlobalSearchReason[];
  rank: number;
};

export type GlobalSearchGroup = {
  key: GlobalSearchKind;
  label: string;
  /** Every match in this group; `results` may hold fewer. */
  total: number;
  results: GlobalSearchResult[];
};

export type GlobalSearchResponse = {
  query: string;
  /** Matches across every group (not only the ones shown). */
  totalResults: number;
  /** Words to paint yellow: what was typed, plus any spelling fixes used. */
  terms: string[];
  /** Amounts / dates / phones recognised in the query. */
  understood: UnderstoodPart[];
  /** Spelling fixes that were also searched for ("באין" → "ביאן"). */
  corrections: string[];
  groups: GlobalSearchGroup[];
};

type Row = {
  kind: string;
  id: string;
  title: string | null;
  subtitle: string | null;
  at: string | null;
  info: Record<string, unknown> | null;
  reasons: Array<{ k?: string; l?: string; v?: string }> | null;
  rank: number | null;
  total: number | string | null;
};

const EMPTY: Omit<GlobalSearchResponse, "query"> = {
  totalResults: 0,
  terms: [],
  understood: [],
  corrections: [],
  groups: [],
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function money(value: unknown): string | null {
  const amount = num(value);
  return amount === null ? null : formatMoney(amount);
}

function day(value: unknown): string | null {
  const text = str(value);
  return text ? formatShortDate(text, "") || null : null;
}

const METHOD_LABELS: Record<string, string> = {
  cash: "מזומן",
  bank_transfer: "העברה בנקאית",
  credit_card: "כרטיס אשראי",
  check: "צ׳ק",
  bit: "ביט",
  other: "אחר",
  card_refund: "זיכוי בכרטיס",
  friend_transfer: "הועבר דרך חבר",
};

function methodLabel(value: unknown): string | null {
  const method = str(value);
  if (!method) return null;
  return METHOD_LABELS[method.toLowerCase()] ?? method;
}

function hours(minutes: unknown): string | null {
  const value = num(minutes);
  if (value === null || value <= 0) return null;
  const h = Math.floor(value / 60);
  const m = Math.round(value % 60);
  return m ? `${h}:${String(m).padStart(2, "0")} שעות` : `${h} שעות`;
}

function chips(...items: Array<string | null | undefined | false>): GlobalSearchMeta[] {
  return items.filter((item): item is string => Boolean(item)).map((text) => ({ text }));
}

/** A reason as the screen shows it: dates and amounts in the app's own format. */
export function formatReason(raw: { k?: string; l?: string; v?: string }): GlobalSearchReason | null {
  const kind = raw.k === "date" || raw.k === "amount" || raw.k === "phone" ? raw.k : "text";
  const label = str(raw.l);
  const value = str(raw.v);
  if (!label || !value) return null;
  if (kind === "date") {
    // A range comes as "start/end".
    const [start, end] = value.split("/");
    const shown = end && end !== start ? `${formatShortDate(start, start)} – ${formatShortDate(end, end)}` : formatShortDate(start, start);
    return { kind, label, value: shown };
  }
  if (kind === "amount") return { kind, label, value: money(value) ?? value };
  return { kind, label, value };
}

/** Where the result opens — always the record itself, never just its section. */
export function hrefFor(kind: GlobalSearchKind, id: string, info: Record<string, unknown>, role: UserRole): string {
  const enc = encodeURIComponent;
  switch (kind) {
    case "customer":
      return `/customers/${enc(id)}`;
    case "contact":
      return str(info.customer_id) ? `/customers/${enc(str(info.customer_id))}` : "/customers";
    case "project":
      return `/projects/${enc(id)}`;
    case "order":
      return `/sales/orders/${enc(id)}`;
    case "task":
      return `/tasks/${enc(id)}`;
    case "payment": {
      if (role === "admin") return buildFocusHref("/financial", `payment:${id}`);
      if (str(info.order_id)) return `/sales/orders/${enc(str(info.order_id))}`;
      if (str(info.project_id)) return `/projects/${enc(str(info.project_id))}`;
      return str(info.method) === "check" ? buildFocusHref("/checks", id) : "/collections";
    }
    case "expense":
      return buildFocusHref("/financial", `expense:${id}`);
    case "document":
      return buildFocusHref("/documents", id);
    case "vehicle":
      return str(info.kind) === "vehicle" ? `/vehicles/${enc(id)}` : "/vehicles";
    case "product":
      return buildFocusHref("/sales?tab=inventory", id);
    case "worker":
      return `/payroll/workers/${enc(id)}`;
    case "worker_payment":
    case "shift":
    case "absence":
    case "salary":
    case "payslip":
      return str(info.user_id) ? `/payroll/workers/${enc(str(info.user_id))}` : "/payroll";
    case "attendance_report":
      return buildFocusHref("/payroll/attendance", id);
    case "invoice":
      return "/invoices";
    case "communication":
      return buildFocusHref("/communications", id);
    case "reminder":
      return str(info.task_id) ? `/tasks/${enc(str(info.task_id))}` : "/inbox";
    case "loan":
      return `/financial/loans/${enc(id)}`;
    case "loan_repayment":
      return str(info.loan_id) ? `/financial/loans/${enc(str(info.loan_id))}` : "/financial/loans";
    case "transfer": {
      const account = str(info.from_account_id) || str(info.to_account_id);
      return buildFocusHref(account ? `/financial/bank?account=${enc(account)}` : "/financial/bank", id);
    }
    case "account":
      return `/financial/bank?account=${enc(id)}`;
    case "card_row":
      return str(info.statement_id) ? buildFocusHref(`/financial/statements/${enc(str(info.statement_id))}`, id) : "/financial/statements";
    case "card_charge":
      return str(info.statement_id) ? `/financial/statements/${enc(str(info.statement_id))}` : "/financial/statements";
    case "card_statement":
      return `/financial/statements/${enc(id)}`;
    case "recurring_expense":
      return buildFocusHref("/financial/payments-calendar?tab=recurring", id);
    case "recurring_task":
      return buildFocusHref("/tasks/recurring", id);
    case "meeting":
      return `/meetings/${enc(id)}`;
    case "property":
      return `/properties/${enc(id)}`;
    case "lease":
      return str(info.property_id) ? `/properties/${enc(str(info.property_id))}` : "/properties";
    case "promise":
      return "/collections";
  }
}

const PROJECT_TYPE_LABELS: Record<string, string> = {
  moving: "הובלה",
  construction: "שיפוצים",
  logistics: "לוגיסטיקה",
  home: "בית",
};

/** The small grey chips under a result: its amount, date, status… */
function metaFor(kind: GlobalSearchKind, info: Record<string, unknown>, at: string | null): GlobalSearchMeta[] {
  switch (kind) {
    case "customer":
      return chips(str(info.phone), info.inactive === true && "לא פעיל");
    case "contact":
      return chips(str(info.role), str(info.phone));
    case "project":
      return chips(
        str(info.status) && getProjectStatusLabel(str(info.status)),
        PROJECT_TYPE_LABELS[str(info.type)],
        money(info.price),
        day(info.start_date)
      );
    case "order":
      return chips(
        day(info.order_date),
        str(info.status) && getOrderStatusLabel(str(info.status)),
        str(info.payment_status) && getPaymentStatusLabel(str(info.payment_status)),
        money(info.total)
      );
    case "task":
      return chips(
        str(info.status) && getTaskStatusLabel(str(info.status)),
        str(info.priority) && getTaskPriorityLabel(str(info.priority)),
        str(info.assignee),
        str(info.due_date) && formatDateWithTime(str(info.due_date), str(info.due_time), "")
      );
    case "payment":
      return chips(
        money(info.amount),
        day(info.date),
        methodLabel(info.method),
        str(info.check_number) && `צ׳ק ${str(info.check_number)}`,
        str(info.status) === "pending" && getPaymentStatusLabel("pending")
      );
    case "expense":
      return chips(
        money(info.amount),
        day(info.date),
        str(info.category),
        str(info.status) === "not_paid" ? "לא שולם" : str(info.status) === "partial" ? "שולם חלקית" : null,
        str(info.installment) && `תשלום ${str(info.installment)}`
      );
    case "document":
      return chips(str(info.type), day(info.doc_date) ?? (str(info.uploaded_at) ? formatShortDateTime(str(info.uploaded_at), "") : null), money(info.amount));
    case "vehicle":
      return chips(
        str(info.test) && `טסט ${day(info.test)}`,
        str(info.insurance) && `ביטוח ${day(info.insurance)}`,
        info.inactive === true && "לא פעיל"
      );
    case "product":
      return chips(str(info.sku), money(info.price), info.inactive === true && "לא פעיל");
    case "worker":
      return chips(str(info.phone), info.active === false && "לא פעיל");
    case "worker_payment":
      return chips(money(info.amount), day(info.date), methodLabel(info.method));
    case "shift":
    case "attendance_report": {
      const start = str(info.clock_in);
      const end = str(info.clock_out);
      return chips(
        start && `${formatShortDate(start, "")} ${formatTimeOnly(start, "")}${end ? `–${formatTimeOnly(end, "")}` : ""}`,
        hours(info.minutes),
        kind === "shift" ? money(info.cost) : null
      );
    }
    case "absence":
      return chips(day(info.date), info.paid === true && "בתשלום");
    case "salary":
      return chips(
        num(info.hourly) !== null && `${money(info.hourly)} לשעה`,
        num(info.monthly) !== null && `${money(info.monthly)} לחודש`
      );
    case "payslip":
      return chips(money(info.gross) && `ברוטו ${money(info.gross)}`);
    case "invoice":
      return chips(money(info.amount), day(info.date));
    case "communication":
      return chips(str(info.date) ? formatShortDateTime(str(info.date), "") : null);
    case "reminder":
      return chips(str(info.when) ? formatShortDateTime(str(info.when), "") : null);
    case "loan":
      return chips(money(info.amount), day(info.date), str(info.due) && `להחזר ${day(info.due)}`);
    case "loan_repayment":
    case "transfer":
    case "card_row":
    case "card_charge":
    case "promise":
      return chips(money(info.amount), day(info.date));
    case "account":
      return chips(str(info.number), info.inactive === true && "לא פעיל");
    case "card_statement":
      return chips(str(info.date) ? formatShortDateTime(str(info.date), "") : null, num(info.rows) !== null && `${num(info.rows)} שורות`);
    case "recurring_expense":
      return chips(money(info.amount), num(info.day) !== null && `ב־${num(info.day)} לחודש`, info.active === false && "לא פעיל");
    case "recurring_task":
      return chips(num(info.day) !== null && `ב־${num(info.day)} לחודש`, info.active === false && "לא פעיל");
    case "meeting":
      return chips(day(info.date));
    case "property":
      return chips(str(info.type), info.inactive === true && "לא פעיל");
    case "lease":
      return chips(money(info.rent) && `${money(info.rent)} לחודש`, day(info.start), day(info.end));
    default:
      return chips(at ? formatShortDate(at, "") : null);
  }
}

/** The result's title as the screen shows it (an order also gets its short number). */
function titleFor(kind: GlobalSearchKind, row: Row): string {
  const title = str(row.title) || GLOBAL_SEARCH_LABELS[kind];
  if (kind === "order") return `${title} · #${row.id.slice(0, 8)}`;
  if (kind === "meeting") {
    const date = day(row.info?.date);
    return date ? `ישיבה ${date}` : title;
  }
  return title;
}

/** One row of public.global_search → one result. */
export function toGlobalSearchResult(row: Row, role: UserRole): GlobalSearchResult | null {
  if (!isGlobalSearchKind(row.kind) || !row.id) return null;
  const kind = row.kind;
  const info = row.info ?? {};
  const reasons = (row.reasons ?? [])
    .map(formatReason)
    .filter((reason): reason is GlobalSearchReason => reason !== null);
  const meta = metaFor(kind, info, row.at).map((item) => ({
    ...item,
    // A chip that IS what matched (₪1,000 when 1000 was searched) is painted too.
    hit: reasons.some((reason) => reason.kind !== "text" && reason.value === item.text) || undefined,
  }));
  return {
    id: row.id,
    group: kind,
    groupLabel: GLOBAL_SEARCH_LABELS[kind],
    title: titleFor(kind, row),
    subtitle: str(row.subtitle) || null,
    meta,
    href: hrefFor(kind, row.id, info, role),
    // Every reason; a screen that already paints the amount as a chip can skip
    // saying it twice (visibleReasons).
    reasons,
    rank: typeof row.rank === "number" ? row.rank : 3,
  };
}

/** Rows (already grouped and ranked by the database) → groups, best groups first. */
export function buildGroups(rows: Row[], role: UserRole): GlobalSearchGroup[] {
  const byKind = new Map<GlobalSearchKind, GlobalSearchGroup & { best: number }>();
  for (const row of rows) {
    const result = toGlobalSearchResult(row, role);
    if (!result) continue;
    const group = byKind.get(result.group) ?? {
      key: result.group,
      label: result.groupLabel,
      total: Number(row.total) || 0,
      results: [],
      best: Number.POSITIVE_INFINITY,
    };
    group.results.push(result);
    group.best = Math.min(group.best, result.rank);
    byKind.set(result.group, group);
  }
  return [...byKind.values()]
    .sort((left, right) => left.best - right.best || GLOBAL_SEARCH_KINDS.indexOf(left.key) - GLOBAL_SEARCH_KINDS.indexOf(right.key))
    .map((group) => ({ key: group.key, label: group.label, total: group.total, results: group.results }));
}

// ── spelling fixes ──────────────────────────────────────────────────────────
// The vocabulary (every word in names, subjects, notes, comments…) is read once
// per signed-in person and kept for ten minutes, so correcting a typo costs no
// extra trip on each keystroke.
const VOCAB_TTL_MS = 10 * 60 * 1000;
const vocabCache = new Map<string, { at: number; words: string[] }>();

async function vocabularyFor(supabase: SupabaseClient, cacheKey: string): Promise<string[]> {
  const cached = vocabCache.get(cacheKey);
  if (cached && Date.now() - cached.at < VOCAB_TTL_MS) return cached.words;
  // One array (not rows), so the API's 1,000-row cap can't cut it short.
  const { data, error } = await supabase.rpc("global_search_vocab");
  if (error) return cached?.words ?? [];
  const words = (Array.isArray(data) ? (data as unknown[]) : []).map(str).filter(Boolean);
  if (vocabCache.size > 200) vocabCache.clear();
  vocabCache.set(cacheKey, { at: Date.now(), words });
  return words;
}

type SearchOptions = {
  query: string;
  viewerRole: UserRole;
  /** Who is searching — the vocabulary is kept per person (it follows their rights). */
  viewerId?: string | null;
  /** Results per group (the total is always counted). */
  limitPerGroup?: number;
  /** Only this kind of record (the "show all" view of one group). */
  kind?: GlobalSearchKind | null;
};

export async function performGlobalSearch(
  supabase: SupabaseClient,
  options: SearchOptions
): Promise<GlobalSearchResponse> {
  const query = options.query.trim();
  const parsed = parseGlobalQuery(query);
  if (!query || parsed.tokens.length === 0) return { query, ...EMPTY };

  const roleKinds = kindsForRole(options.viewerRole);
  if (options.kind && roleKinds && !roleKinds.includes(options.kind)) return { query, ...EMPTY };
  const kinds = options.kind ? [options.kind] : roleKinds;

  // Close spellings for a word that doesn't exist as typed.
  const corrections: string[] = [];
  let tokens: GlobalSearchToken[] = parsed.tokens;
  if (parsed.words.some((word) => word.length >= 3)) {
    const vocabulary = await vocabularyFor(supabase, options.viewerId || options.viewerRole);
    tokens = parsed.tokens.map((token) => {
      const typed = token.t?.[0];
      if (!typed || token.a !== undefined || token.d || token.p) return token;
      const alternatives = fuzzyAlternatives(typed, vocabulary);
      corrections.push(...alternatives);
      return alternatives.length > 0 ? { ...token, t: [typed, ...alternatives] } : token;
    });
  }

  const { data, error } = await supabase.rpc("global_search", {
    p_tokens: tokens,
    p_query: query,
    p_kinds: kinds,
    p_limit: Math.min(Math.max(options.limitPerGroup ?? 5, 1), 500),
  });
  if (error) throw new Error(error.message || "Global search failed");

  const rows = (data ?? []) as Row[];
  const groups = buildGroups(rows, options.viewerRole);
  const terms = Array.from(
    new Set(tokens.flatMap((token) => [...(token.t ?? []), ...(token.h ? [token.h] : [])].filter((term) => term.length > 0)))
  );
  return {
    query,
    totalResults: groups.reduce((sum, group) => sum + group.total, 0),
    terms,
    understood: parsed.understood,
    corrections: Array.from(new Set(corrections)),
    groups,
  };
}

/** What a list page (orders, projects) needs from the search: which rows, and why. */
export type InsideMatches = {
  /** Best match first. */
  ids: string[];
  /** Why each row came up — shown under it, painted yellow. */
  reasons: Record<string, GlobalSearchReason[]>;
  /** Words to paint (what was typed, spelling fixes, an hour). */
  terms: string[];
};

/**
 * The same search, for one kind of record, every match — for the orders and
 * projects pages (owner, 2026-10-19: "search all types of data that can be in
 * a project or order … by date, by hour, by amount").
 */
export async function findInsideMatches(
  supabase: SupabaseClient,
  options: { query: string; kind: "order" | "project"; viewerRole: UserRole; viewerId?: string | null }
): Promise<InsideMatches> {
  const response = await performGlobalSearch(supabase, {
    query: options.query,
    viewerRole: options.viewerRole,
    viewerId: options.viewerId,
    kind: options.kind,
    limitPerGroup: 500,
  });
  const results = response.groups.flatMap((group) => group.results);
  return {
    ids: results.map((result) => result.id),
    reasons: Object.fromEntries(results.map((result) => [result.id, result.reasons])),
    terms: response.terms,
  };
}
