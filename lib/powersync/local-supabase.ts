import type { SupabaseClient } from "@supabase/supabase-js";

// The server's data loaders, run against the on-device copy: a stand-in for
// the Supabase client that answers `.from(...).select(...).eq(...)…` and the
// two directory RPCs from the local PowerSync database, shaped exactly like
// PostgREST's answers (booleans as true/false, numeric as numbers, json
// parsed, timestamps as UTC ISO strings). The loaders themselves stay
// unchanged — one copy of every rule, on both sides.
//
// Covers what the dashboard's loaders use; anything else (an unknown table,
// column, embed or operator) fails loudly instead of answering wrong, so the
// shadow comparison (components/powersync/DashboardLocalShadow) catches gaps.

type Row = Record<string, unknown>;
type Value = unknown;

/** What the local database must offer — PowerSync's `getAll`. */
export type LocalReader = { getAll<T = Row>(sql: string, params?: unknown[]): Promise<T[]> };

// ── Column types: how to give a local value back its Postgres shape ──────────
// PowerSync delivers booleans as 1/0, numeric as text, json as text.

const BOOLEAN_COLUMNS: Record<string, readonly string[]> = {
  users: ["active", "system_access"],
  tasks: ["is_private"],
  customers: ["active", "requires_prepayment"],
  customer_branches: ["active"],
  orders: ["needs_invoice", "collect_payment_on_delivery"],
  projects: ["expenses_billed_separately", "price_includes_vat", "no_charge", "origin_has_elevator", "destination_has_elevator"],
  products: ["active"],
  payments: ["requires_split"],
  properties: ["is_active", "has_private_entrance", "has_storage_room", "has_parking", "has_elevator", "is_furnished"],
  attendance_sessions: ["is_billable_to_customer"],
  project_expenses: ["included_in_base_price", "billed_to_customer"],
  salary_agreements: ["is_billable_to_customer"],
  product_categories: ["active"],
};

const NUMERIC_COLUMNS: Record<string, readonly string[]> = {
  customers: ["delivery_lat", "delivery_lng"],
  inventory: ["quantity_on_hand", "quantity_reserved"],
  lease_agreements: ["monthly_rent_amount", "deposit_amount"],
  order_items: ["quantity_ordered", "quantity_delivered", "unit_price", "discount_amount", "line_total"],
  orders: ["subtotal", "discount_amount", "total_amount"],
  payments: ["amount_total", "amount_including_vat", "amount_before_vat", "net_amount", "vat_rate", "vat_amount"],
  products: ["base_price", "base_cost", "low_stock_threshold"],
  projects: ["agreed_base_price", "actual_price", "vat_rate"],
  properties: ["rooms", "square_meters", "purchase_price", "purchase_tax"],
  attendance_sessions: ["labor_cost", "bill_to_customer_amount"],
  expenses: ["amount", "paid_amount"],
  payslips: ["calculated_base_salary", "manual_adjustments", "gross_salary"],
  salary_agreements: ["hourly_rate", "monthly_salary", "overtime_rate", "standard_daily_hours", "bill_to_customer_amount"],
  worker_payment_allocations: ["amount"],
  worker_payments: ["amount"],
  inventory_movements: ["quantity"],
};

const JSON_COLUMNS: Record<string, readonly string[]> = {
  users: ["notification_prefs"],
  projects: ["items_to_move"],
  properties: ["furniture_items"],
};

/** Tables synced to the device (lib/powersync/schema.ts). */
const LOCAL_TABLES = new Set([
  "users",
  "tasks",
  "task_members",
  "reminders",
  "projects",
  "orders",
  "order_delivery_recipients",
  "customers",
  "customer_branches",
  "order_items",
  "products",
  "inventory",
  "payments",
  "phone_attendance_reports",
  "attendance_sessions",
  "properties",
  "lease_agreements",
  "expenses",
  "project_expenses",
  "payslips",
  "payroll_periods",
  "salary_agreements",
  "worker_payments",
  "worker_payment_allocations",
  "inventory_movements",
  "product_categories",
  "task_comments",
  "document_links",
]);

/**
 * Tables whose device rows carry a made-up `id` (the real key is a pair, or
 * another column): the loaders never select it, and it isn't in Postgres.
 */
const SYNTHETIC_ID_TABLES = new Set(["task_members", "order_delivery_recipients", "inventory"]);

const LOCAL_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/;

/** A local timestamp as an unambiguous UTC ISO string (ms precision, "Z"). */
export function normalizeTimestamp(value: string): string {
  const match = LOCAL_TIMESTAMP.exec(value);
  if (!match) return value;
  const [, date, time, fraction = "", zone] = match;
  const ms = (fraction + "000").slice(0, 3);
  if (!zone || zone === "Z" || /^[+-]00:?00$/.test(zone)) return `${date}T${time}.${ms}Z`;
  const parsed = new Date(`${date}T${time}.${ms}${zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function coerceRow(table: string, row: Row): Row {
  const out: Row = {};
  const booleans = BOOLEAN_COLUMNS[table] ?? [];
  const numerics = NUMERIC_COLUMNS[table] ?? [];
  const jsons = JSON_COLUMNS[table] ?? [];
  for (const [key, raw] of Object.entries(row)) {
    if (SYNTHETIC_ID_TABLES.has(table) && key === "id") continue;
    if (raw === null || raw === undefined) {
      out[key] = null;
    } else if (booleans.includes(key)) {
      out[key] = raw === 1 || raw === "1" || raw === true || raw === "true";
    } else if (numerics.includes(key)) {
      const n = typeof raw === "number" ? raw : Number(raw);
      out[key] = Number.isFinite(n) ? n : null;
    } else if (jsons.includes(key)) {
      try {
        out[key] = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        out[key] = raw;
      }
    } else if (typeof raw === "string") {
      out[key] = normalizeTimestamp(raw);
    } else {
      out[key] = raw;
    }
  }
  return out;
}

// ── Filters (PostgREST semantics, incl. SQL's three-valued NULL logic) ───────

type Filter =
  | { kind: "cmp"; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike"; column: string; value: Value }
  | { kind: "in"; column: string; values: Value[] }
  | { kind: "is"; column: string; value: null | boolean }
  | { kind: "not"; filter: Filter }
  | { kind: "or"; filters: Filter[] }
  | { kind: "and"; filters: Filter[] };

/** Split on top-level commas (not inside parentheses or double quotes). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth += 1;
    if (!quoted && ch === ")") depth -= 1;
    if (!quoted && depth === 0 && ch === ",") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function parseList(value: string): string[] {
  const inner = value.trim().replace(/^\(/, "").replace(/\)$/, "");
  return splitTopLevel(inner).map(unquote);
}

function parseIsValue(value: string): null | boolean {
  const v = value.toLowerCase();
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`Unsupported is.${value}`);
}

function makeFilter(column: string, op: string, value: Value): Filter {
  switch (op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "like":
    case "ilike":
      return { kind: "cmp", op, column, value };
    case "in":
      return { kind: "in", column, values: Array.isArray(value) ? value : parseList(String(value)) };
    case "is":
      return { kind: "is", column, value: typeof value === "string" ? parseIsValue(value) : (value as null | boolean) };
    default:
      throw new Error(`Unsupported filter operator "${op}"`);
  }
}

/** PostgREST logic-tree text: `a.eq.1,and(b.is.null,c.eq.2),d.in.(x,y)`. */
function parseLogic(text: string): Filter[] {
  return splitTopLevel(text).map((part) => {
    const group = /^(not\.)?(and|or)\(([\s\S]*)\)$/.exec(part);
    if (group) {
      const filters = parseLogic(group[3]);
      const node: Filter = group[2] === "and" ? { kind: "and", filters } : { kind: "or", filters };
      return group[1] ? { kind: "not", filter: node } : node;
    }
    const firstDot = part.indexOf(".");
    if (firstDot < 0) throw new Error(`Bad filter "${part}"`);
    const column = part.slice(0, firstDot);
    let rest = part.slice(firstDot + 1);
    let negate = false;
    if (rest.startsWith("not.")) {
      negate = true;
      rest = rest.slice(4);
    }
    const secondDot = rest.indexOf(".");
    if (secondDot < 0) throw new Error(`Bad filter "${part}"`);
    const op = rest.slice(0, secondDot);
    const value = rest.slice(secondDot + 1);
    const filter = makeFilter(column, op, op === "in" ? parseList(value) : unquote(value));
    return negate ? { kind: "not", filter } : filter;
  });
}

const ISO_DATE_OR_TIME = /^\d{4}-\d{2}-\d{2}($|T)/;

function compareValues(a: Value, b: Value): number {
  if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a === true || a === "true") - Number(b === true || b === "true");
  const sa = String(a);
  const sb = String(b);
  if (ISO_DATE_OR_TIME.test(sa) && ISO_DATE_OR_TIME.test(sb)) {
    return Date.parse(sa.length === 10 ? `${sa}T00:00:00Z` : sa) - Date.parse(sb.length === 10 ? `${sb}T00:00:00Z` : sb);
  }
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function sameValue(rowValue: Value, filterValue: Value): boolean {
  if (typeof rowValue === "boolean") return rowValue === (filterValue === true || filterValue === "true");
  if (typeof rowValue === "number") return rowValue === Number(filterValue);
  const a = String(rowValue);
  const b = String(filterValue);
  if (a === b) return true;
  // A timestamp column compared with a timestamp/date written another way.
  return ISO_DATE_OR_TIME.test(a) && ISO_DATE_OR_TIME.test(b) && compareValues(a, b) === 0;
}

function likeToRegExp(pattern: string, insensitive: boolean): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[*%]/g, "[\\s\\S]*")
    .replace(/_/g, "[\\s\\S]");
  return new RegExp(`^${escaped}$`, insensitive ? "i" : "");
}

/** true / false / null (SQL "unknown"); only rows that come out true are kept. */
function evaluate(filter: Filter, row: Row): boolean | null {
  switch (filter.kind) {
    case "cmp": {
      const value = row[filter.column];
      if (value === null || value === undefined || filter.value === null) return null;
      if (filter.op === "eq") return sameValue(value, filter.value);
      if (filter.op === "neq") return !sameValue(value, filter.value);
      if (filter.op === "like" || filter.op === "ilike") {
        return likeToRegExp(String(filter.value), filter.op === "ilike").test(String(value));
      }
      const c = compareValues(value, filter.value);
      if (filter.op === "gt") return c > 0;
      if (filter.op === "gte") return c >= 0;
      if (filter.op === "lt") return c < 0;
      return c <= 0;
    }
    case "in": {
      const value = row[filter.column];
      if (value === null || value === undefined) return null;
      return filter.values.some((candidate) => sameValue(value, candidate));
    }
    case "is": {
      const value = row[filter.column];
      if (filter.value === null) return value === null || value === undefined;
      return value === filter.value;
    }
    case "not": {
      const inner = evaluate(filter.filter, row);
      return inner === null ? null : !inner;
    }
    case "or": {
      let unknown = false;
      for (const f of filter.filters) {
        const r = evaluate(f, row);
        if (r === true) return true;
        if (r === null) unknown = true;
      }
      return unknown ? null : false;
    }
    case "and": {
      let unknown = false;
      for (const f of filter.filters) {
        const r = evaluate(f, row);
        if (r === false) return false;
        if (r === null) unknown = true;
      }
      return unknown ? null : true;
    }
  }
}

// ── Sorting (Postgres: en_US.UTF-8 collation, NULLS LAST ascending) ─────────

const collator = new Intl.Collator("en-US", { sensitivity: "variant", ignorePunctuation: true, numeric: false });

type Order = { column: string; ascending: boolean; nullsFirst: boolean };

function sortRows(rows: Row[], orders: Order[]): Row[] {
  if (orders.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const va = a[order.column];
      const vb = b[order.column];
      const aNull = va === null || va === undefined;
      const bNull = vb === null || vb === undefined;
      if (aNull || bNull) {
        if (aNull && bNull) continue;
        return aNull === order.nullsFirst ? -1 : 1;
      }
      let c: number;
      if (typeof va === "string" && typeof vb === "string" && !(ISO_DATE_OR_TIME.test(va) && ISO_DATE_OR_TIME.test(vb))) {
        c = collator.compare(va, vb);
      } else {
        c = compareValues(va, vb);
      }
      if (c !== 0) return order.ascending ? c : -c;
    }
    return 0;
  });
}

// ── Select lists, embeds ─────────────────────────────────────────────────────

type SelectItem =
  | { kind: "all" }
  | { kind: "column"; column: string; alias: string }
  | { kind: "embed"; key: string; alias: string; items: SelectItem[] };

function parseSelect(text: string): SelectItem[] {
  return splitTopLevel(text.replace(/\s+/g, "")).map((part): SelectItem => {
    if (part === "*") return { kind: "all" };
    const embed = /^(?:([a-zA-Z0-9_]+):)?([a-zA-Z0-9_]+(?:![a-zA-Z0-9_]+)?)\(([\s\S]*)\)$/.exec(part);
    if (embed) {
      const key = embed[2];
      const alias = embed[1] ?? key.split("!")[0];
      return { kind: "embed", key, alias, items: parseSelect(embed[3]) };
    }
    const renamed = /^([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)$/.exec(part);
    if (renamed) return { kind: "column", column: renamed[2], alias: renamed[1] };
    if (!/^[a-zA-Z0-9_]+$/.test(part)) throw new Error(`Unsupported select item "${part}"`);
    return { kind: "column", column: part, alias: part };
  });
}

/**
 * The embeds the loaders use: source table → embed key → target. Many-to-one
 * (the default): `fkColumn` is on the source row and names one target row.
 * One-to-many (`many`): `fkColumn` is on the target rows and points back at
 * the source row's id — the embed is an array, as PostgREST returns it.
 */
type EmbedTarget = { table: string; fkColumn: string; many?: true };
const EMBEDS: Record<string, Record<string, EmbedTarget>> = {
  lease_agreements: { customers: { table: "customers", fkColumn: "customer_id" } },
  project_expenses: { expenses: { table: "expenses", fkColumn: "expense_id" } },
  task_members: { users: { table: "users", fkColumn: "user_id" } },
  tasks: {
    "users!tasks_assigned_user_id_fkey": { table: "users", fkColumn: "assigned_user_id" },
    task_members: { table: "task_members", fkColumn: "task_id", many: true },
  },
};

// ── Sources: tables, the views the loaders read, the directory RPCs ──────────

const CLOSED_FOR_DELIVERY_VIEW = ["draft", "confirmed", "processing", "out_for_delivery", "partially_delivered"];

function trimOrNull(value: Value): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cityOf(address: Value): string | null {
  return trimOrNull(String(address ?? "").split("|")[0]);
}

/** Money summed in whole agorot, like Postgres's exact numeric sum. */
function sumMoney(values: number[]): number {
  return values.reduce((total, v) => total + Math.round(v * 100), 0) / 100;
}

/**
 * A table, view or RPC as the device works it out. `columns`: every column
 * the query reads (selected, filtered on, sorted by), or null for all — so a
 * view can skip the parts nobody asked for.
 */
type SourceLoader = (reader: LocalReader, pushdown: Filter[], columns: Set<string> | null) => Promise<Row[]>;

/** Every column a filter looks at. */
function filterColumns(filter: Filter): string[] {
  switch (filter.kind) {
    case "not":
      return filterColumns(filter.filter);
    case "or":
    case "and":
      return filter.filters.flatMap(filterColumns);
    default:
      return [filter.column];
  }
}

// ── The money views, as Postgres computes them ───────────────────────────────
// Postgres sums numeric exactly; here sums are floats, cleaned of float noise
// (6 decimals) — the figures the app shows (to the agora) come out the same.

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const clean = (value: number): number => Math.round(value * 1e6) / 1e6;
/** numeric(12,2): rounds half away from zero, like Postgres. */
const numeric2 = (value: number): number => (Math.sign(value) * Math.round(Math.abs(value) * 100)) / 100;
/** Postgres's CURRENT_DATE here: the database runs on UTC. */
const utcToday = (): string => new Date().toISOString().slice(0, 10);
const utcDateOf = (timestamp: unknown): string | null => (typeof timestamp === "string" ? timestamp.slice(0, 10) : null);
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** A payslip's due date: day `dueDay` (default 10) of the month after `sourceDate`, capped at that month's end. */
function payslipDueDate(sourceDate: string, dueDay: unknown): string {
  const [year, month] = sourceDate.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const day = Math.min(Math.max(typeof dueDay === "number" ? dueDay : 10, 1), lastDay);
  return `${nextYear}-${pad2(nextMonth)}-${pad2(day)}`;
}

function groupBy<T>(rows: T[], key: (row: T) => unknown): Map<unknown, T[]> {
  const out = new Map<unknown, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k) ?? [];
    list.push(row);
    out.set(k, list);
  }
  return out;
}

/** worker_debt_items_view: what each shift / payslip earned, what's been paid against it, what's owed. */
async function workerDebtItems(reader: LocalReader): Promise<Row[]> {
  const [sessions, users, payslips, periods, agreements, allocations, workerPayments] = await Promise.all([
    loadTable(reader, "attendance_sessions"),
    loadTable(reader, "users"),
    loadTable(reader, "payslips"),
    loadTable(reader, "payroll_periods"),
    loadTable(reader, "salary_agreements"),
    loadTable(reader, "worker_payment_allocations"),
    loadTable(reader, "worker_payments"),
  ]);
  const today = utcToday();
  const trackingMode = new Map(users.map((u) => [u.id, u.pay_tracking_mode]));
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const agreementsByUser = groupBy(agreements, (a) => a.user_id);

  const base: Row[] = [];
  for (const s of sessions) {
    if (trackingMode.get(s.user_id) !== "session" || !(num(s.labor_cost) > 0)) continue;
    const day = utcDateOf(s.clock_in);
    base.push({
      source_type: "session",
      source_id: s.id,
      user_id: s.user_id,
      project_id: s.project_id ?? null,
      payslip_id: null,
      payroll_period_id: null,
      source_date: day,
      due_date: day,
      period_month: day ? day.slice(0, 7) : null,
      worked_minutes: num(s.worked_minutes),
      earned_amount: numeric2(num(s.labor_cost)),
      business_domain: s.business_domain ?? "general_business",
      property_id: s.property_id ?? null,
      is_billable_to_customer: s.is_billable_to_customer === true,
      bill_to_customer_amount: s.bill_to_customer_amount ?? null,
    });
  }
  for (const p of payslips) {
    if (trackingMode.get(p.user_id) !== "payslip" || !(num(p.gross_salary) > 0)) continue;
    const period = p.payroll_period_id ? periodById.get(p.payroll_period_id) : undefined;
    const sourceDate = (period?.end_date as string | null | undefined) ?? today;
    // The agreement in force on that date: latest valid_from, then highest id.
    const agreement = (agreementsByUser.get(p.user_id) ?? [])
      .filter((a) => String(a.valid_from) <= sourceDate && (a.valid_to == null || String(a.valid_to) >= sourceDate))
      .sort((a, b) =>
        String(a.valid_from) === String(b.valid_from)
          ? String(b.id).localeCompare(String(a.id))
          : String(b.valid_from).localeCompare(String(a.valid_from))
      )[0];
    base.push({
      source_type: "payslip",
      source_id: p.id,
      user_id: p.user_id,
      project_id: agreement?.project_id ?? null,
      payslip_id: p.id,
      payroll_period_id: p.payroll_period_id ?? null,
      source_date: sourceDate,
      due_date: payslipDueDate(sourceDate, agreement?.due_day_of_next_month),
      period_month: (period?.period_month as string | null | undefined) ?? today.slice(0, 7),
      worked_minutes: num(p.total_work_minutes),
      earned_amount: numeric2(num(p.gross_salary)),
      business_domain: agreement?.business_domain ?? "general_business",
      property_id: agreement?.property_id ?? null,
      is_billable_to_customer: agreement?.is_billable_to_customer === true,
      bill_to_customer_amount: agreement?.bill_to_customer_amount ?? null,
    });
  }

  // allocation_totals: only allocations whose worker payment exists (inner join).
  const paymentDate = new Map(workerPayments.map((w) => [w.id, w.payment_date as string | null]));
  const paidBySource = new Map<string, { paid: number; last: string | null }>();
  for (const a of allocations) {
    if (!paymentDate.has(a.worker_payment_id)) continue;
    const key = `${a.source_type}:${a.attendance_session_id ?? a.payslip_id}`;
    const entry = paidBySource.get(key) ?? { paid: 0, last: null };
    entry.paid += num(a.amount);
    const date = paymentDate.get(a.worker_payment_id) ?? null;
    if (date && (!entry.last || date > entry.last)) entry.last = date;
    paidBySource.set(key, entry);
  }

  return base.map((b) => {
    const allocated = paidBySource.get(`${b.source_type}:${b.source_id}`);
    const paid = numeric2(allocated?.paid ?? 0);
    const earned = b.earned_amount as number;
    const notDue = b.source_type === "payslip" && String(b.due_date) > today;
    const status =
      Math.abs(paid - earned) < 0.01
        ? "paid"
        : paid > earned + 0.009
          ? "overpaid"
          : notDue
            ? "not_due"
            : paid > 0 && paid + 0.009 < earned
              ? "partial"
              : paid <= 0
                ? "unpaid"
                : "overpaid";
    return {
      ...b,
      paid_amount: paid,
      owed_amount: notDue ? 0 : numeric2(earned - paid),
      payment_status: status,
      last_payment_date: allocated?.last ?? null,
    };
  });
}

/** project_financials_view: each project's price, costs, profit and money collected. */
async function projectFinancials(reader: LocalReader): Promise<Row[]> {
  const [projects, projectExpenses, expenses, sessions, payments, debtItems] = await Promise.all([
    loadTable(reader, "projects"),
    loadTable(reader, "project_expenses"),
    loadTable(reader, "expenses"),
    loadTable(reader, "attendance_sessions"),
    loadTable(reader, "payments"),
    workerDebtItems(reader),
  ]);
  const today = utcToday();
  const expenseAmount = new Map(expenses.map((e) => [e.id, num(e.amount)]));
  const linksByProject = groupBy(projectExpenses, (pe) => pe.project_id);
  const sessionsByProject = groupBy(
    sessions.filter((s) => s.project_id != null),
    (s) => s.project_id
  );
  const payslipItemsByProject = groupBy(
    debtItems.filter((d) => d.source_type === "payslip" && d.project_id != null),
    (d) => d.project_id
  );
  const paymentsByProject = groupBy(
    payments.filter((p) => p.project_id != null),
    (p) => p.project_id
  );
  const isCollected = (p: Row) => !["pending", "rejected"].includes(String(p.payment_status ?? "cleared"));
  const netOf = (p: Row) => (typeof p.net_amount === "number" ? p.net_amount : num(p.amount_total));
  const sum = <T,>(rows: T[], value: (row: T) => number) => clean(rows.reduce((total, row) => total + value(row), 0));

  return projects.map((p) => {
    const links = linksByProject.get(p.id) ?? [];
    const billedExpenses = sum(links, (pe) => (pe.billed_to_customer === true ? expenseAmount.get(pe.expense_id) ?? 0 : 0));
    const allExpenses = sum(links, (pe) => expenseAmount.get(pe.expense_id) ?? 0);

    const projectSessions = sessionsByProject.get(p.id) ?? [];
    const billableSessions = sum(projectSessions, (s) => (s.is_billable_to_customer === true ? num(s.bill_to_customer_amount) : 0));
    const allLabor = sum(projectSessions, (s) => num(s.labor_cost));

    const payslipItems = payslipItemsByProject.get(p.id) ?? [];
    const payslipSalary = sum(payslipItems, (d) => num(d.earned_amount));
    const payslipBilled = sum(payslipItems, (d) => (d.is_billable_to_customer === true ? num(d.bill_to_customer_amount) : 0));

    const projectPayments = paymentsByProject.get(p.id) ?? [];
    const collected = sum(projectPayments, (x) => (isCollected(x) ? netOf(x) : 0));
    const pending = sum(projectPayments, (x) => (x.payment_status === "pending" ? netOf(x) : 0));
    const overdue = sum(projectPayments, (x) =>
      x.payment_status === "pending" && x.due_date != null && String(x.due_date) <= today ? netOf(x) : 0
    );
    const grossCollected = sum(projectPayments, (x) => (isCollected(x) ? num(x.amount_total) : 0));
    const vatCollected = sum(projectPayments, (x) => (isCollected(x) ? num(x.vat_amount) : 0));
    const nextDue =
      projectPayments
        .filter((x) => x.payment_status === "pending" && x.due_date != null)
        .map((x) => String(x.due_date))
        .sort()[0] ?? null;
    const lastPaid =
      projectPayments
        .filter(isCollected)
        .map((x) => utcDateOf(x.payment_date))
        .filter((d): d is string => d !== null)
        .sort()
        .pop() ?? null;

    // Postgres's revenue_base: the agreed or actual price (with VAT when
    // price_includes_vat — as the view has it), else what's been collected.
    const vatFactor = p.price_includes_vat === true ? 1 + (typeof p.vat_rate === "number" ? p.vat_rate : 0.18) : 1;
    const baseRevenue =
      num(p.actual_price) > 0
        ? num(p.actual_price) * vatFactor
        : num(p.agreed_base_price) > 0
          ? num(p.agreed_base_price) * vatFactor
          : collected;
    const effective = clean(Math.max(baseRevenue + billedExpenses + billableSessions + payslipBilled, collected));
    const costs = clean(allExpenses + allLabor + payslipSalary);

    return {
      id: p.id,
      name: p.name,
      agreed_base_price: p.agreed_base_price ?? null,
      actual_price: p.actual_price ?? null,
      total_expenses: costs,
      gross_profit: clean(effective - costs),
      expenses_billed: clean(billedExpenses + billableSessions + payslipBilled),
      customer_total_price: effective,
      total_paid: collected,
      collected_amount: collected,
      pending_amount: pending,
      overdue_amount: overdue,
      next_due_date: nextDue,
      last_payment_date: lastPaid,
      outstanding_amount: clean(Math.max(effective - collected, 0)),
      price_includes_vat: p.price_includes_vat ?? null,
      vat_rate: p.vat_rate ?? null,
      gross_collected: grossCollected,
      vat_collected: vatCollected,
    };
  });
}

async function loadTable(reader: LocalReader, table: string, pushdown: Filter[] = []): Promise<Row[]> {
  // Only exact matches on id / *_id / status columns are pushed into SQL —
  // plain text on both sides, so identical semantics. Every filter (these
  // included) is still evaluated on the coerced rows afterwards.
  const clauses: string[] = [];
  const params: unknown[] = [];
  const pushable = (column: string) => column === "id" || column === "status" || /^[a-z0-9_]+_id$/.test(column);
  for (const filter of pushdown) {
    if (filter.kind === "cmp" && filter.op === "eq" && typeof filter.value === "string" && pushable(filter.column)) {
      clauses.push(`${filter.column} = ?`);
      params.push(filter.value);
    } else if (
      filter.kind === "in" &&
      pushable(filter.column) &&
      filter.values.length > 0 &&
      filter.values.every((v) => typeof v === "string")
    ) {
      clauses.push(`${filter.column} IN (${filter.values.map(() => "?").join(",")})`);
      params.push(...filter.values);
    }
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = await reader.getAll<Row>(`SELECT * FROM ${table}${where}`, params);
  return rows.map((row) => coerceRow(table, row));
}

const VIEWS: Record<string, SourceLoader> = {
  // supabase/migrations: delivery_overview_view — open orders with the
  // customer's and branch's details.
  delivery_overview_view: async (reader) => {
    const [orders, customers, branches] = await Promise.all([
      loadTable(reader, "orders"),
      loadTable(reader, "customers"),
      loadTable(reader, "customer_branches"),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const branchById = new Map(branches.map((b) => [b.id, b]));
    return orders
      .filter((o) => CLOSED_FOR_DELIVERY_VIEW.includes(String(o.status ?? "")))
      .map((o) => {
        const c = customerById.get(o.customer_id) ?? {};
        const cb = (o.branch_id ? branchById.get(o.branch_id) : undefined) ?? {};
        return {
          order_id: o.id,
          customer_id: o.customer_id,
          customer_name: trimOrNull(c.name) ?? trimOrNull(c.name_for_invoice) ?? "לקוח",
          customer_phone: trimOrNull(c.phone),
          customer_address: trimOrNull(c.address),
          customer_city: cityOf(c.address),
          order_date: o.order_date,
          created_at: o.created_at,
          status: o.status ?? "draft",
          total_amount: typeof o.total_amount === "number" ? o.total_amount : 0,
          notes: trimOrNull(o.notes),
          branch_id: o.branch_id ?? null,
          customer_branch_name: trimOrNull(cb.name),
          branch_address: trimOrNull(cb.address),
          branch_phone: trimOrNull(cb.phone),
          branch_city: cityOf(cb.address),
        };
      });
  },

  // order_financials_view — what's been collected per order (cleared or
  // unknown status counts; pending and rejected don't).
  order_financials_view: async (reader, pushdown) => {
    const idFilter = pushdown.find((f) => f.kind === "in" && f.column === "id");
    const orders = await loadTable(reader, "orders", idFilter ? [idFilter] : []);
    const orderIds = orders.map((o) => o.id as string);
    const payments = orderIds.length
      ? await loadTable(reader, "payments", [{ kind: "in", column: "order_id", values: orderIds }])
      : [];
    const byOrder = new Map<string, Row[]>();
    for (const p of payments) {
      const list = byOrder.get(p.order_id as string) ?? [];
      list.push(p);
      byOrder.set(p.order_id as string, list);
    }
    return orders.map((o) => {
      const list = byOrder.get(o.id as string) ?? [];
      const collected = sumMoney(
        list
          .filter((p) => !["pending", "rejected"].includes(String(p.payment_status ?? "cleared")))
          .map((p) => (typeof p.amount_total === "number" ? p.amount_total : 0))
      );
      const total = typeof o.total_amount === "number" ? o.total_amount : 0;
      return {
        id: o.id,
        order_id: o.id,
        customer_id: o.customer_id,
        order_total: total,
        total_amount: total,
        paid_amount: collected,
        total_paid: collected,
        collected_amount: collected,
        remaining_balance: Math.max(sumMoney([total, -collected]), 0),
        outstanding_amount: Math.max(sumMoney([total, -collected]), 0),
        payment_count: list.length,
        payment_status: collected <= 0 ? "unpaid" : collected + 0.009 >= total ? "paid" : "partial",
      };
    });
  },

  worker_debt_items_view: (reader) => workerDebtItems(reader),
  project_financials_view: (reader) => projectFinancials(reader),

  // order_overview_view: each order with its customer, branch, who made it,
  // and its money (collected = cleared or unknown payments; pending; overdue
  // = pending and due by today; the balance never below zero).
  order_overview_view: async (reader) => {
    const [orders, customers, users, branches, payments] = await Promise.all([
      loadTable(reader, "orders"),
      loadTable(reader, "customers"),
      loadTable(reader, "users"),
      loadTable(reader, "customer_branches"),
      loadTable(reader, "payments"),
    ]);
    const today = utcToday();
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const branchById = new Map(branches.map((b) => [b.id, b]));
    const paymentsByOrder = groupBy(
      payments.filter((p) => p.order_id != null),
      (p) => p.order_id
    );
    return orders.map((o) => {
      const c = customerById.get(o.customer_id) ?? {};
      const u = o.created_by ? userById.get(o.created_by) ?? {} : {};
      const cb = o.branch_id ? branchById.get(o.branch_id) ?? {} : {};
      const list = paymentsByOrder.get(o.id) ?? [];
      const collected = clean(
        list.reduce((t, p) => t + (["pending", "rejected"].includes(String(p.payment_status ?? "cleared")) ? 0 : num(p.amount_total)), 0)
      );
      const pending = clean(list.reduce((t, p) => t + (p.payment_status === "pending" ? num(p.amount_total) : 0), 0));
      const overdue = clean(
        list.reduce(
          (t, p) => t + (p.payment_status === "pending" && p.due_date != null && String(p.due_date) <= today ? num(p.amount_total) : 0),
          0
        )
      );
      const nextDue =
        list
          .filter((p) => p.payment_status === "pending" && p.due_date != null)
          .map((p) => String(p.due_date))
          .sort()[0] ?? null;
      const total = num(o.total_amount);
      return {
        order_id: o.id,
        customer_id: o.customer_id,
        customer_name: trimOrNull(c.name) ?? trimOrNull(c.name_for_invoice) ?? "לקוח",
        customer_email: trimOrNull(c.email),
        customer_phone: trimOrNull(c.phone),
        customer_address: trimOrNull(c.address),
        customer_city: cityOf(c.address),
        order_date: o.order_date,
        created_at: o.created_at,
        status: o.status ?? "draft",
        payment_status: collected <= 0 ? "unpaid" : collected + 0.009 >= total ? "paid" : "partial",
        discount_amount: num(o.discount_amount),
        total_amount: total,
        total_paid: collected,
        collected_amount: collected,
        pending_amount: pending,
        overdue_amount: overdue,
        next_due_date: nextDue,
        remaining_balance: clean(Math.max(total - collected, 0)),
        payment_count: list.length,
        created_by_user_id: o.created_by ?? null,
        created_by_name: trimOrNull(u.full_name) ?? trimOrNull(u.email),
        notes: trimOrNull(o.notes),
        customer_name_for_invoice: trimOrNull(c.name_for_invoice),
        needs_invoice: o.needs_invoice ?? null,
        invoice_sent_at: o.invoice_sent_at ?? null,
        delivery_confirmed_at: o.delivery_confirmed_at ?? null,
        branch_id: o.branch_id ?? null,
        customer_branch_name: trimOrNull(cb.name),
      };
    });
  },

  // project_worker_balance_view: the workers' pay items, summed per project.
  project_worker_balance_view: async (reader) => {
    const byProject = groupBy(
      (await workerDebtItems(reader)).filter((d) => d.project_id != null),
      (d) => d.project_id
    );
    return [...byProject].map(([projectId, items]) => ({
      project_id: projectId,
      item_count: items.length,
      earned_amount: numeric2(items.reduce((t, d) => t + num(d.earned_amount), 0)),
      paid_amount: numeric2(items.reduce((t, d) => t + num(d.paid_amount), 0)),
      owed_amount: numeric2(items.reduce((t, d) => t + num(d.owed_amount), 0)),
    }));
  },

  // project_dashboard_view = project_overview_view (inner join customers, the
  // manager's name) + project_financials_view + task progress (tasks this
  // viewer can see) + a few project columns + the customer's phone.
  // The money and the task counts are worked out only when the query reads
  // them (a picker asking for id + name doesn't need every payment).
  project_dashboard_view: async (reader, _pushdown, columns) => {
    const wants = (names: string[]) => columns === null || names.some((n) => columns.has(n));
    const needsMoney = wants(PROJECT_DASHBOARD_MONEY_COLUMNS);
    const needsTasks = wants(["total_tasks", "completed_tasks", "open_tasks"]);
    const [projects, customers, users, tasks, financials] = await Promise.all([
      loadTable(reader, "projects"),
      loadTable(reader, "customers"),
      loadTable(reader, "users"),
      needsTasks ? loadTable(reader, "tasks") : Promise.resolve([] as Row[]),
      needsMoney ? projectFinancials(reader) : Promise.resolve([] as Row[]),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const userName = new Map(users.map((u) => [u.id, u.full_name]));
    const financialsById = new Map(financials.map((f) => [f.id, f]));
    const tasksByProject = groupBy(
      tasks.filter((t) => t.project_id != null),
      (t) => t.project_id
    );
    return projects
      .filter((p) => customerById.has(p.customer_id))
      .map((p) => {
        const customer = customerById.get(p.customer_id) ?? {};
        const f = financialsById.get(p.id) ?? {};
        const projectTasks = tasksByProject.get(p.id) ?? [];
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          project_type: p.project_type,
          start_date: p.start_date,
          end_date: p.end_date,
          agreed_base_price: p.agreed_base_price,
          actual_price: p.actual_price,
          expenses_billed_separately: p.expenses_billed_separately,
          customer_id: p.customer_id,
          customer_name: customer.name ?? null,
          project_manager_id: p.project_manager_id ?? null,
          project_manager_name: p.project_manager_id ? userName.get(p.project_manager_id) ?? null : null,
          created_at: p.created_at,
          updated_at: p.updated_at,
          total_expenses: f.total_expenses ?? null,
          gross_profit: f.gross_profit ?? null,
          total_tasks: projectTasks.length,
          completed_tasks: projectTasks.filter((t) => t.status === "done").length,
          open_tasks: projectTasks.filter((t) => t.status != null && t.status !== "done").length,
          customer_total_price: f.customer_total_price ?? null,
          expenses_billed: f.expenses_billed ?? null,
          collected_amount: f.collected_amount ?? null,
          pending_amount: f.pending_amount ?? null,
          overdue_amount: f.overdue_amount ?? null,
          outstanding_amount: f.outstanding_amount ?? null,
          next_due_date: f.next_due_date ?? null,
          payment_terms: p.payment_terms,
          due_date: p.due_date,
          no_charge: p.no_charge,
          branch_id: p.branch_id,
          customer_phone: customer.phone ?? null,
        };
      });
  },
};

/** project_dashboard_view's columns that come from project_financials_view. */
const PROJECT_DASHBOARD_MONEY_COLUMNS = [
  "total_expenses", "gross_profit", "customer_total_price", "expenses_billed", "collected_amount",
  "pending_amount", "overdue_amount", "outstanding_amount", "next_due_date",
];

const RPCS: Record<string, SourceLoader> = {
  // user_directory(): logs_shifts needs pay types the device doesn't hold.
  user_directory: async (reader) =>
    (await loadTable(reader, "users")).map((u) => ({
      id: u.id,
      full_name: u.full_name,
      avatar_color: u.avatar_color,
      role: u.role,
      active: u.active,
    })),
  property_directory: async (reader) =>
    (await loadTable(reader, "properties")).map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      is_active: p.is_active,
    })),
};

// ── The query builder ────────────────────────────────────────────────────────

type CountOption = { count?: "exact" | "planned" | "estimated"; head?: boolean };
type Result = { data: unknown; error: { message: string } | null; count: number | null; status: number };

/** An embed in a select list: which table, through which column, inner or not. */
type EmbedSpec = EmbedTarget & { inner: boolean };

/** One resolved embed: the embedded value for a source row (null / [] when nothing matches). */
type ResolvedEmbed = { spec: EmbedSpec; valueFor: (row: Row) => Row | Row[] | null };

function embedSpec(table: string, key: string): EmbedSpec | null {
  const direct = EMBEDS[table]?.[key];
  if (direct) return { ...direct, inner: false };
  const [name, hint] = key.split("!");
  const byName = EMBEDS[table]?.[name];
  return byName && (hint === "inner" || hint === "left") ? { ...byName, inner: hint === "inner" } : null;
}

class LocalQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  /** Filters on an embedded resource ("expenses.payment_status"), by embed alias. */
  private embedFilters = new Map<string, Filter[]>();
  private orders: Order[] = [];
  private selectText = "*";
  private countOption: CountOption = {};
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private singleMode: "one" | "maybe" | null = null;

  constructor(
    private reader: LocalReader,
    private source: { kind: "table" | "view" | "rpc"; name: string }
  ) {}

  select(columns = "*", options: CountOption = {}) {
    this.selectText = columns;
    this.countOption = options;
    return this;
  }
  eq(column: string, value: Value) { return this.push(column, (c) => makeFilter(c, "eq", value)); }
  neq(column: string, value: Value) { return this.push(column, (c) => makeFilter(c, "neq", value)); }
  gt(column: string, value: Value) { return this.push(column, (c) => makeFilter(c, "gt", value)); }
  gte(column: string, value: Value) { return this.push(column, (c) => makeFilter(c, "gte", value)); }
  lt(column: string, value: Value) { return this.push(column, (c) => makeFilter(c, "lt", value)); }
  lte(column: string, value: Value) { return this.push(column, (c) => makeFilter(c, "lte", value)); }
  like(column: string, value: string) { return this.push(column, (c) => makeFilter(c, "like", value)); }
  ilike(column: string, value: string) { return this.push(column, (c) => makeFilter(c, "ilike", value)); }
  in(column: string, values: readonly Value[]) { return this.push(column, (c) => ({ kind: "in", column: c, values: [...values] })); }
  is(column: string, value: null | boolean) { return this.push(column, (c) => ({ kind: "is", column: c, value })); }
  not(column: string, op: string, value: Value) {
    return this.push(column, (c) => ({ kind: "not", filter: makeFilter(c, op, op === "in" ? parseList(String(value)) : value) }));
  }
  or(text: string) { this.filters.push({ kind: "or", filters: parseLogic(text) }); return this; }
  filter(column: string, op: string, value: Value) { return this.push(column, (c) => makeFilter(c, op, value)); }

  /** A filter on this row, or — "alias.column" — on an embedded row. */
  private push(column: string, build: (column: string) => Filter) {
    const dot = column.indexOf(".");
    if (dot < 0) {
      this.filters.push(build(column));
    } else {
      const alias = column.slice(0, dot);
      const list = this.embedFilters.get(alias) ?? [];
      list.push(build(column.slice(dot + 1)));
      this.embedFilters.set(alias, list);
    }
    return this;
  }
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const ascending = options.ascending ?? true;
    this.orders.push({ column, ascending, nullsFirst: options.nullsFirst ?? !ascending });
    return this;
  }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  limit(count: number) { this.rangeTo = this.rangeFrom + count - 1; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "one"; return this; }

  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.run().then(onFulfilled, onRejected);
  }

  private async loadSource(): Promise<Row[]> {
    const { kind, name } = this.source;
    if (kind === "rpc") {
      const rpc = RPCS[name];
      if (!rpc) throw new Error(`RPC ${name} isn't available on the device`);
      return rpc(this.reader, this.filters, null);
    }
    if (VIEWS[name]) return VIEWS[name](this.reader, this.filters, this.columnsRead());
    if (!LOCAL_TABLES.has(name)) throw new Error(`Table ${name} isn't synced to the device`);
    return loadTable(this.reader, name, this.filters);
  }

  /** Every column this query reads from its source — null when it selects "*". */
  private columnsRead(): Set<string> | null {
    const items = parseSelect(this.selectText);
    if (items.some((i) => i.kind === "all")) return null;
    return new Set([
      ...items.flatMap((i) => (i.kind === "column" ? [i.column] : [])),
      ...this.filters.flatMap(filterColumns),
      ...this.orders.map((o) => o.column),
    ]);
  }

  /** Each embed in `items`: its target rows (projected) for each source row, after the embed's filters. */
  private async resolveEmbeds(
    rows: Row[],
    items: SelectItem[],
    table: string,
    filtersByAlias: Map<string, Filter[]>
  ): Promise<Map<string, ResolvedEmbed>> {
    const resolved = new Map<string, ResolvedEmbed>();
    for (const embed of items) {
      if (embed.kind !== "embed") continue;
      const spec = embedSpec(table, embed.key);
      if (!spec) throw new Error(`Embed ${table} → ${embed.key} isn't available on the device`);
      // Many-to-one: the targets the rows point at. One-to-many: the targets pointing at the rows.
      const keyColumn = spec.many ? "id" : spec.fkColumn;
      const ids = [...new Set(rows.map((r) => r[keyColumn]).filter((v): v is string => typeof v === "string"))];
      const lookupColumn = spec.many ? spec.fkColumn : "id";
      const loaded = ids.length ? await loadTable(this.reader, spec.table, [{ kind: "in", column: lookupColumn, values: ids }]) : [];
      const own = filtersByAlias.get(embed.alias) ?? [];
      const targets = loaded.filter((t) => own.every((f) => evaluate(f, t) === true));
      const projected = await this.project(targets, embed.items, spec.table, new Map());
      if (spec.many) {
        const byParent = new Map<unknown, Row[]>();
        targets.forEach((t, i) => byParent.set(t[spec.fkColumn], [...(byParent.get(t[spec.fkColumn]) ?? []), projected[i]]));
        resolved.set(embed.alias, { spec, valueFor: (row) => byParent.get(row.id) ?? [] });
      } else {
        const byId = new Map(targets.map((t, i) => [t.id, projected[i]]));
        resolved.set(embed.alias, { spec, valueFor: (row) => byId.get(row[spec.fkColumn]) ?? null });
      }
    }
    return resolved;
  }

  private async project(rows: Row[], items: SelectItem[], table: string, filtersByAlias: Map<string, Filter[]>): Promise<Row[]> {
    const embedded = await this.resolveEmbeds(rows, items, table, filtersByAlias);
    return rows.map((row) => {
      const out: Row = {};
      for (const item of items) {
        if (item.kind === "all") {
          Object.assign(out, row);
        } else if (item.kind === "column") {
          if (!(item.column in row)) throw new Error(`Column ${table}.${item.column} isn't available on the device`);
          out[item.alias] = row[item.column];
        } else {
          out[item.alias] = embedded.get(item.alias)?.valueFor(row) ?? null;
        }
      }
      return out;
    });
  }

  private async run(): Promise<Result> {
    try {
      const items = parseSelect(this.selectText);
      for (const alias of this.embedFilters.keys()) {
        if (!items.some((i) => i.kind === "embed" && i.alias === alias)) throw new Error(`Filter on "${alias}", which isn't embedded`);
      }
      const all = await this.loadSource();
      let filtered = all.filter((row) => this.filters.every((f) => evaluate(f, row) === true));
      // An inner embed keeps only rows whose embedded row exists (one-to-many:
      // at least one) and passes that embed's filters — before sorting,
      // counting and paging.
      const innerEmbeds = items.filter(
        (i): i is Extract<SelectItem, { kind: "embed" }> => i.kind === "embed" && embedSpec(this.source.name, i.key)?.inner === true
      );
      if (innerEmbeds.length) {
        const resolved = await this.resolveEmbeds(filtered, innerEmbeds, this.source.name, this.embedFilters);
        filtered = filtered.filter((row) =>
          [...resolved.values()].every(({ valueFor }) => {
            const value = valueFor(row);
            return Array.isArray(value) ? value.length > 0 : value !== null;
          })
        );
      }
      const sorted = sortRows(filtered, this.orders);
      const end = this.rangeTo === null ? undefined : this.rangeTo + 1;
      const page = sorted.slice(this.rangeFrom, end);
      const count = this.countOption.count ? filtered.length : null;
      if (this.countOption.head) return { data: null, error: null, count, status: 200 };
      const data = await this.project(page, items, this.source.name, this.embedFilters);
      if (this.singleMode) {
        if (data.length > 1) return { data: null, error: { message: "More than one row" }, count, status: 406 };
        if (data.length === 0 && this.singleMode === "one") return { data: null, error: { message: "No rows" }, count, status: 406 };
        return { data: data[0] ?? null, error: null, count, status: 200 };
      }
      return { data, error: null, count, status: 200 };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) }, count: null, status: 500 };
    }
  }
}

/**
 * A Supabase-client stand-in reading the on-device copy. Pass it to the same
 * loaders the server uses (`getMyTasks(createLocalSupabase(db), …)`).
 */
export function createLocalSupabase(reader: LocalReader): SupabaseClient {
  const client = {
    from: (name: string) => new LocalQuery(reader, { kind: VIEWS[name] ? "view" : "table", name }),
    rpc: (name: string) => new LocalQuery(reader, { kind: "rpc", name }),
  };
  return client as unknown as SupabaseClient;
}
