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

/** Many-to-one embeds the loaders use: source table → embed key → (table, FK column). */
const EMBEDS: Record<string, Record<string, { table: string; fkColumn: string }>> = {
  lease_agreements: { customers: { table: "customers", fkColumn: "customer_id" } },
  task_members: { users: { table: "users", fkColumn: "user_id" } },
  tasks: { "users!tasks_assigned_user_id_fkey": { table: "users", fkColumn: "assigned_user_id" } },
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

type SourceLoader = (reader: LocalReader, pushdown: Filter[]) => Promise<Row[]>;

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

  // project_dashboard_view — only the project's own columns and the customer's
  // name; its money and task-progress columns aren't available on the device.
  project_dashboard_view: async (reader) => {
    const [projects, customers] = await Promise.all([loadTable(reader, "projects"), loadTable(reader, "customers")]);
    const customerName = new Map(customers.map((c) => [c.id, c.name]));
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      project_type: p.project_type,
      start_date: p.start_date,
      end_date: p.end_date,
      customer_id: p.customer_id,
      customer_name: customerName.get(p.customer_id) ?? null,
      project_manager_id: p.project_manager_id,
      created_at: p.created_at,
      updated_at: p.updated_at,
      payment_terms: p.payment_terms,
      due_date: p.due_date,
      no_charge: p.no_charge,
      branch_id: p.branch_id,
    }));
  },
};

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

class LocalQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
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
  eq(column: string, value: Value) { this.filters.push(makeFilter(column, "eq", value)); return this; }
  neq(column: string, value: Value) { this.filters.push(makeFilter(column, "neq", value)); return this; }
  gt(column: string, value: Value) { this.filters.push(makeFilter(column, "gt", value)); return this; }
  gte(column: string, value: Value) { this.filters.push(makeFilter(column, "gte", value)); return this; }
  lt(column: string, value: Value) { this.filters.push(makeFilter(column, "lt", value)); return this; }
  lte(column: string, value: Value) { this.filters.push(makeFilter(column, "lte", value)); return this; }
  like(column: string, value: string) { this.filters.push(makeFilter(column, "like", value)); return this; }
  ilike(column: string, value: string) { this.filters.push(makeFilter(column, "ilike", value)); return this; }
  in(column: string, values: readonly Value[]) { this.filters.push({ kind: "in", column, values: [...values] }); return this; }
  is(column: string, value: null | boolean) { this.filters.push({ kind: "is", column, value }); return this; }
  not(column: string, op: string, value: Value) {
    this.filters.push({ kind: "not", filter: makeFilter(column, op, op === "in" ? parseList(String(value)) : value) });
    return this;
  }
  or(text: string) { this.filters.push({ kind: "or", filters: parseLogic(text) }); return this; }
  filter(column: string, op: string, value: Value) { this.filters.push(makeFilter(column, op, value)); return this; }
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
      return rpc(this.reader, this.filters);
    }
    if (VIEWS[name]) return VIEWS[name](this.reader, this.filters);
    if (!LOCAL_TABLES.has(name)) throw new Error(`Table ${name} isn't synced to the device`);
    return loadTable(this.reader, name, this.filters);
  }

  private async project(rows: Row[], items: SelectItem[], table: string): Promise<Row[]> {
    const embeds = items.filter((i): i is Extract<SelectItem, { kind: "embed" }> => i.kind === "embed");
    const embedded = new Map<string, Map<unknown, Row>>();
    for (const embed of embeds) {
      const spec = EMBEDS[table]?.[embed.key];
      if (!spec) throw new Error(`Embed ${table} → ${embed.key} isn't available on the device`);
      const ids = [...new Set(rows.map((r) => r[spec.fkColumn]).filter((v): v is string => typeof v === "string"))];
      const targets = ids.length ? await loadTable(this.reader, spec.table, [{ kind: "in", column: "id", values: ids }]) : [];
      const projected = await this.project(targets, embed.items, spec.table);
      embedded.set(embed.alias, new Map(targets.map((t, i) => [t.id, projected[i]])));
    }
    return rows.map((row) => {
      const out: Row = {};
      for (const item of items) {
        if (item.kind === "all") {
          Object.assign(out, row);
        } else if (item.kind === "column") {
          if (!(item.column in row)) throw new Error(`Column ${table}.${item.column} isn't available on the device`);
          out[item.alias] = row[item.column];
        } else {
          const spec = EMBEDS[table][item.key];
          out[item.alias] = embedded.get(item.alias)?.get(row[spec.fkColumn]) ?? null;
        }
      }
      return out;
    });
  }

  private async run(): Promise<Result> {
    try {
      const all = await this.loadSource();
      const filtered = all.filter((row) => this.filters.every((f) => evaluate(f, row) === true));
      const sorted = sortRows(filtered, this.orders);
      const end = this.rangeTo === null ? undefined : this.rangeTo + 1;
      const page = sorted.slice(this.rangeFrom, end);
      const count = this.countOption.count ? filtered.length : null;
      if (this.countOption.head) return { data: null, error: null, count, status: 200 };
      const data = await this.project(page, parseSelect(this.selectText), this.source.name);
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
