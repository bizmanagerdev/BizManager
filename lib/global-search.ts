import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/requireProfile";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";

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
  | "users";

export type GlobalSearchResult = {
  id: string;
  group: GlobalSearchGroupKey;
  groupLabel: string;
  title: string;
  subtitle: string | null;
  meta: string[];
  href: string;
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
  users: "עובדים",
};

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

function includesNormalized(haystackParts: Array<string | null | undefined>, query: string) {
  const normalizedQuery = normalizeHebrewText(query);
  if (!normalizedQuery) return false;
  const haystack = normalizeHebrewText(haystackParts.filter(Boolean).join(" "));
  return haystack.includes(normalizedQuery);
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
  const name = text(row.customer_name);
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

  if (!query) {
    return { query: "", totalResults: 0, groups: [] };
  }

  const requests = [
    supabase
      .from("customer_overview_view")
      .select("customer_id,customer_name,phone,email,address")
      .order("customer_name", { ascending: true })
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
      .select("id,payment_date,amount_total,payment_method,reference_number,notes,business_domain,project_id,order_id,property_id")
      .order("payment_date", { ascending: false })
      .range(0, fetchSize - 1),
    supabase
      .from("expenses")
      .select("id,expense_date,amount,category,description,notes,business_domain,project_id,order_id,property_id")
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

  const customers = sortByMatch(
    ((customersResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.customer_id) || text(row.id), query)) ||
      includesNormalized([text(row.customer_name), text(row.email), text(row.phone), text(row.address)], query)
    ),
    query,
    (row) => [text(row.customer_name), text(row.email), text(row.phone), text(row.address)]
  ).slice(0, limitPerGroup);

  const projects = sortByMatch(
    ((projectsResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.name), text(row.customer_name), text(row.status), text(row.project_type)], query)
    ),
    query,
    (row) => [text(row.name), text(row.customer_name), text(row.status), text(row.project_type)]
  ).slice(0, limitPerGroup);

  const tasks = sortByMatch(
    ((tasksResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.task_id) || text(row.id), query)) ||
      includesNormalized(
        [text(row.subject), text(row.project_name), text(row.status), text(row.priority), text(row.assigned_user_name)],
        query
      )
    ),
    query,
    (row) => [text(row.subject), text(row.project_name), text(row.assigned_user_name), text(row.status), text(row.priority)]
  ).slice(0, limitPerGroup);

  const orders = sortByMatch(
    ((ordersResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.order_id) || text(row.id), query)) ||
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
    ),
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

  const payments = sortByMatch(
    ((paymentsResult.data ?? []) as Row[]).filter((row) =>
      (uuidLike && exactIdMatch(text(row.id), query)) ||
      includesNormalized([text(row.reference_number), text(row.notes), text(row.payment_method), text(row.business_domain)], query)
    ),
    query,
    (row) => [text(row.notes), text(row.reference_number), text(row.payment_method), text(row.business_domain)]
  ).slice(0, limitPerGroup);

  const expenses = sortByMatch(
    ((expensesResult.data ?? []) as Row[]).filter((row) =>
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
      text(row.customer_name),
    ])
  );

  const contacts = sortByMatch(
    ((contactsResult.data ?? []) as Row[]).filter((row) =>
      includesNormalized([text(row.full_name), text(row.phone), text(row.email), text(row.whatsapp), text(row.role)], query)
    ),
    query,
    (row) => [text(row.full_name), text(row.phone), text(row.email), text(row.role)]
  ).slice(0, limitPerGroup);

  const results = [
    ...(customers.map(customerResult).filter(Boolean) as GlobalSearchResult[]),
    ...(contacts.map((row) => contactResult(row, customerNameById)).filter(Boolean) as GlobalSearchResult[]),
    ...(projects.map(projectResult).filter(Boolean) as GlobalSearchResult[]),
    ...(tasks.map(taskResult).filter(Boolean) as GlobalSearchResult[]),
    ...(orders.map(orderResult).filter(Boolean) as GlobalSearchResult[]),
    ...(products.map(productResult).filter(Boolean) as GlobalSearchResult[]),
    ...(documents.map((row) => documentResult(row, query)).filter(Boolean) as GlobalSearchResult[]),
    ...(properties.map(propertyResult).filter(Boolean) as GlobalSearchResult[]),
    ...(payments.map(paymentResult).filter(Boolean) as GlobalSearchResult[]),
    ...(expenses.map(expenseResult).filter(Boolean) as GlobalSearchResult[]),
    ...(users.map(userResult).filter(Boolean) as GlobalSearchResult[]),
  ];

  return {
    query,
    totalResults: results.length,
    groups: buildGroups(results),
  };
}
