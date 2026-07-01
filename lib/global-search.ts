import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/requireProfile";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import { customerMatchesQuery, fuzzyTextMatch, phoneMatchesQuery } from "@/lib/search/customerMatch";
import {
  findMatchingRowIds,
  findOrderIdsMatchingContent,
  findProjectIdsMatchingContent,
} from "@/lib/search/findMatchingChildIds";

export type GlobalSearchGroupKey =
  | "customers"
  | "contacts"
  | "projects"
  | "tasks"
  | "orders"
  | "products"
  | "documents"
  | "properties"
  | "payments"
  | "expenses"
  | "tags"
  | "users";

export type GlobalSearchResult = {
  id: string;
  group: GlobalSearchGroupKey;
  groupLabel: string;
  title: string;
  subtitle: string | null;
  meta: string[];
  href: string;
  // Why this result surfaced, when the match was on a field NOT already shown in
  // the title (e.g. a note, a comment, a phone, a product). label is a short
  // Hebrew field name; snippet is the matching text (highlighted in the UI).
  match?: { label: string; snippet: string } | null;
};

export type GlobalSearchResponse = {
  query: string;
  totalResults: number;
  groups: Array<{
    key: GlobalSearchGroupKey;
    label: string;
    results: GlobalSearchResult[];
  }>;
};

type SearchOptions = {
  query: string;
  viewerRole: UserRole;
  limitPerGroup?: number;
  mode?: "quick" | "full";
};

type Row = Record<string, unknown>;

const GROUP_LABELS: Record<GlobalSearchGroupKey, string> = {
  customers: "לקוחות",
  contacts: "אנשי קשר",
  projects: "פרויקטים",
  tasks: "משימות",
  orders: "הזמנות",
  products: "מוצרים",
  documents: "מסמכים",
  properties: "נכסים",
  payments: "הכנסות",
  expenses: "הוצאות",
  tags: "רכבים ותגיות",
  users: "עובדים",
};

function tagKindLabel(kind: string) {
  switch (kind) {
    case "vehicle":
      return "רכב";
    case "campaign":
      return "קמפיין";
    case "equipment":
      return "ציוד";
    case "event":
      return "אירוע";
    case "vendor":
      return "ספק";
    default:
      return "תגית";
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isUuidLike(value: string) {
  return /^[0-9a-f-]{8,}$/i.test(value);
}

// A short preview of a matched field, WINDOWED around the matched term so the
// highlight is visible even in a long note (truncating from the start could hide
// it). Falls back to a head slice when the raw term isn't found (fuzzy match).
function snippetAround(value: string, query: string, max = 80) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const idx = clean.toLowerCase().indexOf(query.trim().toLowerCase());
  if (idx < 0) return `${clean.slice(0, max - 1)}…`;
  const pad = Math.floor((max - Math.min(query.length, max)) / 2);
  const end = Math.min(clean.length, Math.max(idx + query.length + pad, idx - pad + max));
  const start = Math.max(0, end - max);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function windowMatch(
  match: { label: string; snippet: string } | null | undefined,
  query: string
): { label: string; snippet: string } | null {
  return match ? { label: match.label, snippet: snippetAround(match.snippet, query) } : null;
}

// Find which of the given (label, value) fields contains the query, so the UI
// can tell the user WHY a result surfaced. Returns the first hidden field that
// matches (the title/name is handled separately — it's already on screen).
function buildMatch(
  query: string,
  candidates: Array<[label: string, value: string | null | undefined]>
): { label: string; snippet: string } | null {
  const needle = normalizeHebrewText(query);
  if (!needle) return null;
  for (const [label, rawValue] of candidates) {
    const value = (rawValue ?? "").trim();
    if (!value) continue;
    if (normalizeHebrewText(value).includes(needle)) {
      return { label, snippet: snippetAround(value, query) };
    }
  }
  return null;
}

function attachMatch(
  result: GlobalSearchResult | null,
  match: { label: string; snippet: string } | null
): GlobalSearchResult | null {
  if (result && match) result.match = match;
  return result;
}

function normalizeHebrewText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״"'`´.,/\\|()[\]{}\-–—_:;!?+=*&^%$#@~<>]/g, " ")
    .replace(/[ך]/g, "כ")
    .replace(/[ם]/g, "מ")
    .replace(/[ן]/g, "נ")
    .replace(/[ף]/g, "פ")
    .replace(/[ץ]/g, "צ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Fuzzy (typo / letter-swap tolerant) match across the joined fields, so e.g.
// "באין" still finds "ביאן". The global search is the most sophisticated
// surface and applies this everywhere, not just to names.
function includesNormalized(haystackParts: Array<string | null | undefined>, query: string) {
  return fuzzyTextMatch(haystackParts.filter(Boolean).join(" "), query);
}

function exactIdMatch(id: string | null | undefined, query: string) {
  const normalizedId = text(id);
  return Boolean(normalizedId) && normalizedId.toLowerCase() === query.toLowerCase();
}

function sortByMatch<T extends Row>(
  rows: T[],
  query: string,
  getRankParts: (row: T) => Array<string | null | undefined>
) {
  const normalizedQuery = normalizeHebrewText(query);
  return [...rows].sort((left, right) => {
    const leftText = normalizeHebrewText(getRankParts(left).filter(Boolean).join(" "));
    const rightText = normalizeHebrewText(getRankParts(right).filter(Boolean).join(" "));
    const leftStarts = leftText.startsWith(normalizedQuery) ? 1 : 0;
    const rightStarts = rightText.startsWith(normalizedQuery) ? 1 : 0;
    if (leftStarts !== rightStarts) return rightStarts - leftStarts;

    const leftIndex = leftText.indexOf(normalizedQuery);
    const rightIndex = rightText.indexOf(normalizedQuery);
    const safeLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const safeRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (safeLeftIndex !== safeRightIndex) return safeLeftIndex - safeRightIndex;

    return leftText.localeCompare(rightText, "he");
  });
}

function formatCurrency(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function projectTypeLabel(value: unknown) {
  switch (text(value)) {
    case "moving":
      return "הובלה";
    case "construction":
      return "שיפוצים";
    case "logistics":
      return "לוגיסטיקה";
    default:
      return text(value);
  }
}

function buildGroups(results: GlobalSearchResult[]): GlobalSearchResponse["groups"] {
  const byGroup = new Map<GlobalSearchGroupKey, GlobalSearchResult[]>();

  for (const result of results) {
    const list = byGroup.get(result.group) ?? [];
    list.push(result);
    byGroup.set(result.group, list);
  }

  return Array.from(byGroup.entries()).map(([key, groupResults]) => ({
    key,
    label: GROUP_LABELS[key],
    results: groupResults,
  }));
}

function customerResult(row: Row): GlobalSearchResult | null {
  const id = text(row.customer_id) || text(row.id);
  const name = text(row.customer_name) || text(row.name) || text(row.name_for_invoice);
  if (!id || !name) return null;
  return {
    id,
    group: "customers",
    groupLabel: GROUP_LABELS.customers,
    title: name,
    subtitle: text(row.address) || null,
    meta: [text(row.phone), text(row.email)].filter(Boolean),
    href: `/customers/${encodeURIComponent(id)}`,
  };
}

function projectResult(row: Row): GlobalSearchResult | null {
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  return {
    id,
    group: "projects",
    groupLabel: GROUP_LABELS.projects,
    title: name,
    subtitle: text(row.customer_name) || null,
    meta: [getProjectStatusLabel(text(row.status)), projectTypeLabel(row.project_type)].filter(Boolean),
    href: `/projects/${encodeURIComponent(id)}`,
  };
}

function taskResult(row: Row): GlobalSearchResult | null {
  const id = text(row.task_id) || text(row.id);
  const subject = text(row.subject);
  if (!id || !subject) return null;
  return {
    id,
    group: "tasks",
    groupLabel: GROUP_LABELS.tasks,
    title: subject,
    subtitle: text(row.project_name) || null,
    meta: [text(row.status), text(row.priority), text(row.assigned_user_name), text(row.due_date)].filter(Boolean),
    href: `/tasks/${encodeURIComponent(id)}`,
  };
}

function orderResult(row: Row): GlobalSearchResult | null {
  const id = text(row.order_id) || text(row.id);
  if (!id) return null;
  const customerName = text(row.customer_name);
  return {
    id,
    group: "orders",
    groupLabel: GROUP_LABELS.orders,
    title: customerName ? `${customerName} · #${shortId(id)}` : `הזמנה #${shortId(id)}`,
    subtitle: text(row.order_date) || null,
    meta: [text(row.status), text(row.payment_status), formatCurrency(num(row.total_amount))].filter(Boolean) as string[],
    href: `/sales/orders/${encodeURIComponent(id)}`,
  };
}

function productResult(row: Row): GlobalSearchResult | null {
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  return {
    id,
    group: "products",
    groupLabel: GROUP_LABELS.products,
    title: name,
    subtitle: text(row.description) || null,
    meta: [text(row.sku), text(row.barcode), formatCurrency(num(row.base_price))].filter(Boolean) as string[],
    href: "/sales?tab=price-list",
  };
}

function documentResult(row: Row, query: string): GlobalSearchResult | null {
  const id = text(row.id);
  const title = text(row.title) || text(row.file_name);
  if (!id || !title) return null;
  return {
    id,
    group: "documents",
    groupLabel: GROUP_LABELS.documents,
    title,
    subtitle: text(row.file_name) || null,
    meta: [text(row.document_type), text(row.uploaded_at)].filter(Boolean),
    href: `/documents?q=${encodeURIComponent(query)}`,
  };
}

function propertyResult(row: Row): GlobalSearchResult | null {
  const id = text(row.id);
  const address = text(row.address);
  if (!id || !address) return null;
  return {
    id,
    group: "properties",
    groupLabel: GROUP_LABELS.properties,
    title: address,
    subtitle: row.is_active === false ? "נכס לא פעיל" : "נכס",
    meta: [],
    href: "/properties",
  };
}

function paymentResult(row: Row): GlobalSearchResult | null {
  const id = text(row.id);
  if (!id) return null;
  const domain = text(row.business_domain);
  const sourceId =
    domain === "logistics_projects"
      ? text(row.project_id)
      : domain === "sales"
        ? text(row.order_id)
        : domain === "property_management"
          ? text(row.property_id)
          : "";
  const params = new URLSearchParams({ type: "inflow" });
  if (domain) params.set("domain", domain);
  if (sourceId) params.set("sourceId", sourceId);

  return {
    id,
    group: "payments",
    groupLabel: GROUP_LABELS.payments,
    title: text(row.notes) || text(row.reference_number) || `תשלום #${shortId(id)}`,
    subtitle: text(row.payment_date) || null,
    meta: [formatCurrency(num(row.amount_total)), text(row.payment_method), text(row.business_domain)].filter(Boolean) as string[],
    href: `/financial?${params.toString()}`,
  };
}

function expenseResult(row: Row): GlobalSearchResult | null {
  const id = text(row.id);
  if (!id) return null;
  const domain = text(row.business_domain);
  const sourceId =
    domain === "logistics_projects"
      ? text(row.project_id)
      : domain === "sales"
        ? text(row.order_id)
        : domain === "property_management"
          ? text(row.property_id)
          : "";
  const params = new URLSearchParams({ type: "outflow" });
  if (domain) params.set("domain", domain);
  if (sourceId) params.set("sourceId", sourceId);

  return {
    id,
    group: "expenses",
    groupLabel: GROUP_LABELS.expenses,
    title: text(row.description) || text(row.category) || `הוצאה #${shortId(id)}`,
    subtitle: text(row.expense_date) || null,
    meta: [formatCurrency(num(row.amount)), text(row.category), text(row.business_domain)].filter(Boolean) as string[],
    href: `/financial?${params.toString()}`,
  };
}

function contactResult(row: Row, customerNameById: Map<string, string>): GlobalSearchResult | null {
  const id = text(row.id);
  const customerId = text(row.customer_id);
  const name = text(row.full_name);
  if (!id || !customerId || !name) return null;
  const customerName = customerNameById.get(customerId) ?? null;
  return {
    id,
    group: "contacts",
    groupLabel: GROUP_LABELS.contacts,
    title: name,
    subtitle: customerName,
    meta: [text(row.role), text(row.phone), text(row.email)].filter(Boolean),
    href: `/customers/${encodeURIComponent(customerId)}`,
  };
}

function tagResult(row: Row): GlobalSearchResult | null {
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  const kind = text(row.kind);
  return {
    id,
    group: "tags",
    groupLabel: GROUP_LABELS.tags,
    title: name,
    subtitle: tagKindLabel(kind),
    meta: [],
    // A vehicle tag opens its activity rollup; other kinds land on the list.
    href: kind === "vehicle" ? `/vehicles/${encodeURIComponent(id)}` : "/vehicles",
  };
}

function userResult(row: Row): GlobalSearchResult | null {
  const id = text(row.id);
  const name = text(row.full_name) || text(row.email);
  if (!id || !name) return null;
  return {
    id,
    group: "users",
    groupLabel: GROUP_LABELS.users,
    title: name,
    subtitle: text(row.email) || null,
    meta: [text(row.role), row.active === false ? "לא פעיל" : "פעיל"].filter(Boolean),
    href: `/payroll/workers/${encodeURIComponent(id)}`,
  };
}

const PAYMENT_COLUMNS =
  "id,payment_date,amount_total,payment_method,reference_number,notes,business_domain,project_id,order_id,property_id";
const EXPENSE_COLUMNS =
  "id,expense_date,amount,category,description,notes,business_domain,project_id,order_id,property_id";
const CUSTOMER_COLUMNS = "id,name,name_for_invoice,phone,whatsapp,email,address";
const TAG_COLUMNS = "id,kind,name,color,is_active";

type MatchContent = import("@/lib/search/findMatchingChildIds").ChildMatchResult;
const emptyContent = (): MatchContent => ({ ids: [], contextById: new Map() });

export async function performGlobalSearch(
  supabase: SupabaseClient,
  options: SearchOptions
): Promise<GlobalSearchResponse> {
  const query = options.query.trim();
  const limitPerGroup = Math.min(Math.max(options.limitPerGroup ?? 6, 1), 12);
  const mode = options.mode ?? "full";
  const fetchSize =
    mode === "quick"
      ? Math.max(limitPerGroup * 4, 24)
      : Math.max(limitPerGroup * 8, 80);
  const uuidLike = isUuidLike(query);
  // Deep cross-table reach: task comments, order notes/line-items, project tasks,
  // and payment/expense notes. Runs for BOTH the top-bar type-ahead ("quick") and
  // the full search page so a comment/note is findable wherever you search. Each
  // is an indexed ilike over modest tables; the type-ahead is debounced + abort-
  // able, so the extra round-trips don't pile up.
  const deep = true;

  if (!query) {
    return { query: "", totalResults: 0, groups: [] };
  }

  const requests = [
    supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone,whatsapp,email,address")
      .order("name", { ascending: true })
      .range(0, fetchSize - 1),
    supabase
      .from("project_dashboard_view")
      .select("id,name,customer_name,status,project_type,updated_at")
      .order("updated_at", { ascending: false })
      .range(0, fetchSize - 1),
    supabase
      .from("task_overview_view")
      .select("task_id,subject,project_name,status,priority,assigned_user_name,due_date,updated_at")
      .order("updated_at", { ascending: false })
      .range(0, fetchSize - 1),
    supabase
      .from("order_overview_view")
      .select("order_id,customer_name,status,payment_status,total_amount,order_date,customer_email,customer_phone,customer_address")
      .order("order_date", { ascending: false })
      .range(0, fetchSize - 1),
    supabase
      .from("products")
      .select("id,name,sku,barcode,description,base_price")
      .order("name", { ascending: true })
      .range(0, fetchSize - 1),
    supabase
      .from("documents")
      .select("id,title,file_name,document_type,uploaded_at,notes")
      .order("uploaded_at", { ascending: false, nullsFirst: false })
      .range(0, fetchSize - 1),
    supabase
      .from("properties")
      .select("id,address,is_active")
      .order("address", { ascending: true })
      .range(0, fetchSize - 1),
    supabase
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .order("payment_date", { ascending: false })
      .range(0, fetchSize - 1),
    supabase
      .from("expenses")
      .select(EXPENSE_COLUMNS)
      .order("expense_date", { ascending: false })
      .range(0, fetchSize - 1),
    options.viewerRole === "admin"
      ? supabase
          .from("users")
          .select("id,full_name,email,role,active,phone")
          .order("full_name", { ascending: true })
          .range(0, fetchSize - 1)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("contacts")
      .select("id,customer_id,full_name,role,phone,email,whatsapp")
      .eq("active", true)
      .order("full_name", { ascending: true })
      .range(0, fetchSize - 1),
    supabase
      .from("tags")
      .select(TAG_COLUMNS)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .range(0, fetchSize - 1),
  ] as const;

  const [
    customersResult,
    projectsResult,
    tasksResult,
    ordersResult,
    productsResult,
    documentsResult,
    propertiesResult,
    paymentsResult,
    expensesResult,
    usersResult,
    contactsResult,
    tagsResult,
  ] = await Promise.all(requests);

  const errors = [
    customersResult.error,
    projectsResult.error,
    tasksResult.error,
    ordersResult.error,
    productsResult.error,
    documentsResult.error,
    propertiesResult.error,
    paymentsResult.error,
    expensesResult.error,
    usersResult.error,
    contactsResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "Global search failed");
  }

  // ── Deep, fuzzy, cross-table reach ──────────────────────────────────────────
  // One fuzzy engine (findMatchingRowIds: indexed ILIKE across the whole table +
  // a bounded fuzzy fallback for typos) resolves notes/free-text and child records
  // system-wide, so a search finds a row by ANY field — a customer/project/car
  // note, an order comment, a task comment — no matter how old. Ids resolved here
  // are pulled into their groups below (fetching any outside the recent window),
  // and the matching text is carried for the "why it matched" line.
  const [
    orderContent,
    projectContent,
    customerContent,
    paymentContent,
    expenseContent,
    tagContent,
    vehicleContent,
    commentContent,
  ] = deep
    ? await Promise.all([
        findOrderIdsMatchingContent(supabase, query, fetchSize),
        findProjectIdsMatchingContent(supabase, query, fetchSize),
        findMatchingRowIds(supabase, {
          table: "customers",
          columns: [
            { name: "notes", label: "הערה" },
            { name: "name", label: "שם" },
            { name: "name_for_invoice", label: "שם לחשבונית" },
            { name: "phone", label: "טלפון" },
            { name: "email", label: "אימייל" },
            { name: "address", label: "כתובת" },
          ],
          query,
          limit: fetchSize,
        }),
        findMatchingRowIds(supabase, {
          table: "payments",
          columns: [
            { name: "notes", label: "הערה" },
            { name: "reference_number", label: "אסמכתא" },
          ],
          query,
          limit: fetchSize,
          scanOrderColumn: "payment_date",
        }),
        findMatchingRowIds(supabase, {
          table: "expenses",
          columns: [
            { name: "notes", label: "הערה" },
            { name: "description", label: "תיאור" },
            { name: "category", label: "קטגוריה" },
          ],
          query,
          limit: fetchSize,
          scanOrderColumn: "expense_date",
        }),
        findMatchingRowIds(supabase, {
          table: "tags",
          columns: [
            { name: "name", label: "שם" },
            { name: "notes", label: "הערה" },
          ],
          query,
          limit: fetchSize,
          eq: { column: "is_active", value: true },
        }),
        findMatchingRowIds(supabase, {
          table: "vehicles",
          columns: [
            { name: "license_plate", label: "מספר רישוי" },
            { name: "make_model", label: "דגם" },
            { name: "owner_name", label: "בעלים" },
            { name: "notes", label: "הערה" },
          ],
          query,
          idColumn: "tag_id",
          limit: fetchSize,
        }),
        findMatchingRowIds(supabase, {
          table: "task_comments",
          columns: [{ name: "body", label: "תגובה" }],
          query,
          idColumn: "task_id",
          limit: fetchSize,
          scanOrderColumn: "created_at",
        }),
      ])
    : [emptyContent(), emptyContent(), emptyContent(), emptyContent(), emptyContent(), emptyContent(), emptyContent(), emptyContent()];

  const itemOrderIds = orderContent.ids;
  const orderMatchById = orderContent.contextById;
  const projectMatchById = projectContent.contextById;
  const customerMatchById = customerContent.contextById;
  const paymentMatchById = paymentContent.contextById;
  const expenseMatchById = expenseContent.contextById;
  // Cars and other tags share the "tags" group; a vehicle match maps to its tag id.
  const tagMatchById = new Map(tagContent.contextById);
  for (const [id, ctx] of vehicleContent.contextById) if (!tagMatchById.has(id)) tagMatchById.set(id, ctx);
  const tagContentIds = [...tagMatchById.keys()];
  // Comment → task, for the tasks group (comment → project is handled in projectContent).
  const commentByTaskId = new Map<string, string>();
  for (const [taskId, ctx] of commentContent.contextById) commentByTaskId.set(taskId, ctx.snippet);

  // Fetch rows that matched deep but fall outside a group's recent window.
  const fetchByIds = async (
    table: string,
    select: string,
    idColumn: string,
    ids: string[],
    have: Set<string>
  ): Promise<Row[]> => {
    const missing = ids.filter((id) => id && !have.has(id));
    if (missing.length === 0) return [];
    const { data } = await supabase
      .from(table)
      .select(select)
      .in(idColumn, missing.slice(0, fetchSize))
      .range(0, fetchSize - 1);
    return (data ?? []) as unknown as Row[];
  };

  // Customers (+ deep note / full-coverage field matches).
  const customerIdMatch = new Set(customerContent.ids);
  const customerRows = (customersResult.data ?? []) as Row[];
  const customerHave = new Set(customerRows.map((row) => text(row.customer_id) || text(row.id)));
  const extraCustomerRows = await fetchByIds("customers", CUSTOMER_COLUMNS, "id", customerContent.ids, customerHave);
  const customers = sortByMatch(
    [...customerRows, ...extraCustomerRows].filter((row) => {
      const id = text(row.customer_id) || text(row.id);
      return (
        customerIdMatch.has(id) ||
        (uuidLike && exactIdMatch(id, query)) ||
        customerMatchesQuery(
          {
            name: text(row.name) || text(row.customer_name),
            name_for_invoice: text(row.name_for_invoice),
            email: text(row.email),
            phone: text(row.phone),
            whatsapp: text(row.whatsapp),
            address: text(row.address),
          },
          query
        )
      );
    }),
    query,
    (row) => [text(row.name) || text(row.customer_name), text(row.name_for_invoice), text(row.email), text(row.phone)]
  ).slice(0, limitPerGroup);

  // Projects (+ deep note / task / comment matches).
  const projectIdMatch = new Set(projectContent.ids);
  const projectRows = (projectsResult.data ?? []) as Row[];
  const projectHave = new Set(projectRows.map((row) => text(row.id)));
  const taskProjectRows = await fetchByIds(
    "project_dashboard_view",
    "id,name,customer_name,status,project_type,updated_at",
    "id",
    projectContent.ids,
    projectHave
  );
  const projects = sortByMatch(
    [...projectRows, ...taskProjectRows].filter((row) =>
      projectIdMatch.has(text(row.id)) ||
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.name), text(row.customer_name), text(row.status), text(row.project_type)], query)
    ),
    query,
    (row) => [text(row.name), text(row.customer_name), text(row.status), text(row.project_type)]
  ).slice(0, limitPerGroup);

  // Comments → parent task. task_comments has no page of its own, so a matching
  // comment (fuzzy, any age — resolved above) surfaces the task it belongs to.
  const taskRows = (tasksResult.data ?? []) as Row[];
  const taskHave = new Set(taskRows.map((row) => text(row.task_id) || text(row.id)));
  const commentTaskRows = await fetchByIds(
    "task_overview_view",
    "task_id,subject,project_name,status,priority,assigned_user_name,due_date,updated_at",
    "task_id",
    commentContent.ids,
    taskHave
  );

  const tasks = sortByMatch(
    [...taskRows, ...commentTaskRows].filter((row) => {
      const taskId = text(row.task_id) || text(row.id);
      return (
        commentByTaskId.has(taskId) ||
        (uuidLike && exactIdMatch(taskId, query)) ||
        includesNormalized(
          [text(row.subject), text(row.project_name), text(row.status), text(row.priority), text(row.assigned_user_name)],
          query
        )
      );
    }),
    query,
    (row) => [text(row.subject), text(row.project_name), text(row.assigned_user_name), text(row.status), text(row.priority)]
  ).slice(0, limitPerGroup);

  const orderIdsFromItems = new Set(itemOrderIds);
  const orderRows = (ordersResult.data ?? []) as Row[];
  const orderRowIds = new Set(orderRows.map((row) => text(row.order_id) || text(row.id)));
  const missingOrderIds = itemOrderIds.filter((id) => id && !orderRowIds.has(id));
  let itemOrderRows: Row[] = [];
  if (missingOrderIds.length > 0) {
    const { data } = await supabase
      .from("order_overview_view")
      .select("order_id,customer_name,status,payment_status,total_amount,order_date,customer_email,customer_phone,customer_address")
      .in("order_id", missingOrderIds.slice(0, fetchSize))
      .range(0, fetchSize - 1);
    itemOrderRows = (data ?? []) as Row[];
  }

  const orders = sortByMatch(
    [...orderRows, ...itemOrderRows].filter((row) => {
      const orderId = text(row.order_id) || text(row.id);
      return (
        orderIdsFromItems.has(orderId) ||
        (uuidLike && exactIdMatch(orderId, query)) ||
        includesNormalized(
          [
            text(row.customer_name),
            text(row.status),
            text(row.payment_status),
            text(row.customer_email),
            text(row.customer_phone),
            text(row.customer_address),
          ],
          query
        )
      );
    }),
    query,
    (row) => [text(row.customer_name), text(row.customer_phone), text(row.customer_address), text(row.status)]
  ).slice(0, limitPerGroup);

  const products = sortByMatch(
    ((productsResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.name), text(row.sku), text(row.barcode), text(row.description)], query)
    ),
    query,
    (row) => [text(row.name), text(row.sku), text(row.barcode), text(row.description)]
  ).slice(0, limitPerGroup);

  const documents = sortByMatch(
    ((documentsResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.title), text(row.file_name), text(row.notes), text(row.document_type)], query)
    ),
    query,
    (row) => [text(row.title), text(row.file_name), text(row.document_type), text(row.notes)]
  ).slice(0, limitPerGroup);

  const properties = sortByMatch(
    ((propertiesResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.address)], query)
    ),
    query,
    (row) => [text(row.address)]
  ).slice(0, limitPerGroup);

  // Deep mode: payments/expenses whose NOTES (a payment's "comment") or
  // reference/description/category match, fetched server-side so they're found no
  // matter how old they are — not just within the recent window loaded above.
  // Merged (deduped) into the candidates below. (Commas/percent are stripped: the
  // value sits inside an or() list where a comma is a delimiter.)
  // Payments/expenses: window matches (fuzzy, recent) + deep note/reference matches
  // (fuzzy, any age — resolved above), merged and deduped by id.
  const paymentIdMatch = new Set(paymentContent.ids);
  const paymentHave = new Set(((paymentsResult.data ?? []) as Row[]).map((row) => text(row.id)));
  const extraPaymentRows = await fetchByIds("payments", PAYMENT_COLUMNS, "id", paymentContent.ids, paymentHave);
  const payments = sortByMatch(
    [...((paymentsResult.data ?? []) as Row[]), ...extraPaymentRows].filter((row) =>
      paymentIdMatch.has(text(row.id)) ||
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.reference_number), text(row.notes), text(row.payment_method), text(row.business_domain)], query)
    ),
    query,
    (row) => [text(row.notes), text(row.reference_number), text(row.payment_method), text(row.business_domain)]
  ).slice(0, limitPerGroup);

  const expenseIdMatch = new Set(expenseContent.ids);
  const expenseHave = new Set(((expensesResult.data ?? []) as Row[]).map((row) => text(row.id)));
  const extraExpenseRows = await fetchByIds("expenses", EXPENSE_COLUMNS, "id", expenseContent.ids, expenseHave);
  const expenses = sortByMatch(
    [...((expensesResult.data ?? []) as Row[]), ...extraExpenseRows].filter((row) =>
      expenseIdMatch.has(text(row.id)) ||
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.category), text(row.description), text(row.notes), text(row.business_domain)], query)
    ),
    query,
    (row) => [text(row.description), text(row.category), text(row.notes), text(row.business_domain)]
  ).slice(0, limitPerGroup);

  const users = sortByMatch(
    ((usersResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.full_name), text(row.email), text(row.phone), text(row.role)], query)
    ),
    query,
    (row) => [text(row.full_name), text(row.email), text(row.phone), text(row.role)]
  ).slice(0, limitPerGroup);

  const customerNameById = new Map<string, string>(
    ((customersResult.data ?? []) as Row[]).map((row) => [
      text(row.customer_id) || text(row.id),
      text(row.customer_name) || text(row.name) || text(row.name_for_invoice),
    ])
  );

  const contacts = sortByMatch(
    ((contactsResult.data ?? []) as Row[]).filter((row) =>
      fuzzyTextMatch([text(row.full_name), text(row.role)].join(" "), query) ||
      phoneMatchesQuery([text(row.phone), text(row.whatsapp)], query) ||
      includesNormalized([text(row.email)], query)
    ),
    query,
    (row) => [text(row.full_name), text(row.phone), text(row.email), text(row.role)]
  ).slice(0, limitPerGroup);

  // Tags / vehicles ("cars"). Window matches by name + deep matches on tag notes
  // and vehicle fields (license plate, model, owner, notes — a vehicle maps to its
  // tag id). Resilient: a missing table never breaks the rest of search.
  const tagIdMatch = new Set(tagContentIds);
  const tagRows = (tagsResult.error ? [] : tagsResult.data ?? []) as Row[];
  const tagHave = new Set(tagRows.map((row) => text(row.id)));
  const extraTagRows = await fetchByIds("tags", TAG_COLUMNS, "id", tagContentIds, tagHave);
  const tags = sortByMatch(
    [...tagRows, ...extraTagRows].filter((row) =>
      tagIdMatch.has(text(row.id)) ||
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.name), text(row.kind)], query)
    ),
    query,
    (row) => [text(row.name)]
  ).slice(0, limitPerGroup);

  const results = [
    ...(customers
      .map((row) =>
        attachMatch(
          customerResult(row),
          windowMatch(customerMatchById.get(text(row.customer_id) || text(row.id)), query) ??
            buildMatch(query, [
              ["טלפון", text(row.phone)],
              ["וואטסאפ", text(row.whatsapp)],
              ["אימייל", text(row.email)],
              ["כתובת", text(row.address)],
              ["שם לחשבונית", text(row.name_for_invoice)],
            ])
        )
      )
      .filter(Boolean) as GlobalSearchResult[]),
    ...(contacts
      .map((row) =>
        attachMatch(
          contactResult(row, customerNameById),
          buildMatch(query, [
            ["טלפון", text(row.phone)],
            ["וואטסאפ", text(row.whatsapp)],
            ["אימייל", text(row.email)],
            ["תפקיד", text(row.role)],
          ])
        )
      )
      .filter(Boolean) as GlobalSearchResult[]),
    ...(projects
      .map((row) => attachMatch(projectResult(row), windowMatch(projectMatchById.get(text(row.id)), query)))
      .filter(Boolean) as GlobalSearchResult[]),
    ...(tasks
      .map((row) => {
        const taskId = text(row.task_id) || text(row.id);
        const body = commentByTaskId.get(taskId);
        const match = body
          ? windowMatch({ label: "תגובה", snippet: body }, query)
          : buildMatch(query, [["אחראי", text(row.assigned_user_name)]]);
        return attachMatch(taskResult(row), match);
      })
      .filter(Boolean) as GlobalSearchResult[]),
    ...(tags
      .map((row) => attachMatch(tagResult(row), windowMatch(tagMatchById.get(text(row.id)), query)))
      .filter(Boolean) as GlobalSearchResult[]),
    ...(orders
      .map((row) => {
        const orderId = text(row.order_id) || text(row.id);
        const match =
          windowMatch(orderMatchById.get(orderId), query) ??
          buildMatch(query, [
            ["טלפון", text(row.customer_phone)],
            ["אימייל", text(row.customer_email)],
            ["עיר", text(row.customer_city)],
            ["כתובת", text(row.customer_address)],
          ]);
        return attachMatch(orderResult(row), match);
      })
      .filter(Boolean) as GlobalSearchResult[]),
    ...(products
      .map((row) =>
        attachMatch(
          productResult(row),
          buildMatch(query, [
            ["מק\"ט", text(row.sku)],
            ["ברקוד", text(row.barcode)],
            ["תיאור", text(row.description)],
          ])
        )
      )
      .filter(Boolean) as GlobalSearchResult[]),
    ...(documents
      .map((row) =>
        attachMatch(
          documentResult(row, query),
          buildMatch(query, [
            ["הערה", text(row.notes)],
            ["סוג", text(row.document_type)],
            ["קובץ", text(row.file_name)],
          ])
        )
      )
      .filter(Boolean) as GlobalSearchResult[]),
    ...(properties.map(propertyResult).filter(Boolean) as GlobalSearchResult[]),
    ...(payments
      .map((row) =>
        attachMatch(
          paymentResult(row),
          windowMatch(paymentMatchById.get(text(row.id)), query) ??
            buildMatch(query, [
              ["הערה", text(row.notes)],
              ["אסמכתא", text(row.reference_number)],
              ["אמצעי תשלום", text(row.payment_method)],
            ])
        )
      )
      .filter(Boolean) as GlobalSearchResult[]),
    ...(expenses
      .map((row) =>
        attachMatch(
          expenseResult(row),
          windowMatch(expenseMatchById.get(text(row.id)), query) ??
            buildMatch(query, [
              ["הערה", text(row.notes)],
              ["קטגוריה", text(row.category)],
              ["תיאור", text(row.description)],
            ])
        )
      )
      .filter(Boolean) as GlobalSearchResult[]),
    ...(users
      .map((row) =>
        attachMatch(
          userResult(row),
          buildMatch(query, [
            ["אימייל", text(row.email)],
            ["טלפון", text(row.phone)],
          ])
        )
      )
      .filter(Boolean) as GlobalSearchResult[]),
  ];

  return {
    query,
    totalResults: results.length,
    groups: buildGroups(results),
  };
}
