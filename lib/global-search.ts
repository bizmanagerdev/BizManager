import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/requireProfile";

export type GlobalSearchGroupKey =
  | "customers"
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
};

type Row = Record<string, unknown>;

const GROUP_LABELS: Record<GlobalSearchGroupKey, string> = {
  customers: "לקוחות",
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

function escapeForOrFilter(query: string) {
  return query.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function isUuidLike(value: string) {
  return /^[0-9a-f-]{8,}$/i.test(value);
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
    href: `/customers?customer_id=${encodeURIComponent(id)}`,
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
    meta: [text(row.status), text(row.project_type)].filter(Boolean),
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
    title: customerName ? `${customerName} · #${shortId(id)}` : `Order #${shortId(id)}`,
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
    href: "/payroll",
  };
}

export async function performGlobalSearch(
  supabase: SupabaseClient,
  options: SearchOptions
): Promise<GlobalSearchResponse> {
  const query = options.query.trim();
  const limitPerGroup = Math.min(Math.max(options.limitPerGroup ?? 6, 1), 12);

  if (!query) {
    return { query: "", totalResults: 0, groups: [] };
  }

  const filter = escapeForOrFilter(query);
  const uuidLike = isUuidLike(filter);

  const requests = [
    supabase
      .from("customer_overview_view")
      .select("customer_id,customer_name,phone,email,address")
      .or(
        uuidLike
          ? `customer_id.eq.${filter},customer_name.ilike.%${filter}%,email.ilike.%${filter}%,phone.ilike.%${filter}%,address.ilike.%${filter}%`
          : `customer_name.ilike.%${filter}%,email.ilike.%${filter}%,phone.ilike.%${filter}%,address.ilike.%${filter}%`
      )
      .order("customer_name", { ascending: true })
      .range(0, limitPerGroup - 1),
    supabase
      .from("project_dashboard_view")
      .select("id,name,customer_name,status,project_type,updated_at")
      .or(
        uuidLike
          ? `id.eq.${filter},name.ilike.%${filter}%,customer_name.ilike.%${filter}%,status.ilike.%${filter}%,project_type.ilike.%${filter}%`
          : `name.ilike.%${filter}%,customer_name.ilike.%${filter}%,status.ilike.%${filter}%,project_type.ilike.%${filter}%`
      )
      .order("updated_at", { ascending: false })
      .range(0, limitPerGroup - 1),
    supabase
      .from("task_overview_view")
      .select("task_id,subject,project_name,status,priority,assigned_user_name,due_date,updated_at")
      .or(
        uuidLike
          ? `task_id.eq.${filter},subject.ilike.%${filter}%,project_name.ilike.%${filter}%,status.ilike.%${filter}%,priority.ilike.%${filter}%,assigned_user_name.ilike.%${filter}%`
          : `subject.ilike.%${filter}%,project_name.ilike.%${filter}%,status.ilike.%${filter}%,priority.ilike.%${filter}%,assigned_user_name.ilike.%${filter}%`
      )
      .order("updated_at", { ascending: false })
      .range(0, limitPerGroup - 1),
    supabase
      .from("order_overview_view")
      .select("order_id,customer_name,status,payment_status,total_amount,order_date,customer_email,customer_phone,customer_address")
      .or(
        uuidLike
          ? `order_id.eq.${filter},customer_name.ilike.%${filter}%,status.ilike.%${filter}%,payment_status.ilike.%${filter}%,customer_email.ilike.%${filter}%,customer_phone.ilike.%${filter}%,customer_address.ilike.%${filter}%`
          : `customer_name.ilike.%${filter}%,status.ilike.%${filter}%,payment_status.ilike.%${filter}%,customer_email.ilike.%${filter}%,customer_phone.ilike.%${filter}%,customer_address.ilike.%${filter}%`
      )
      .order("order_date", { ascending: false })
      .range(0, limitPerGroup - 1),
    supabase
      .from("products")
      .select("id,name,sku,barcode,description,base_price")
      .or(
        uuidLike
          ? `id.eq.${filter},name.ilike.%${filter}%,sku.ilike.%${filter}%,barcode.ilike.%${filter}%,description.ilike.%${filter}%`
          : `name.ilike.%${filter}%,sku.ilike.%${filter}%,barcode.ilike.%${filter}%,description.ilike.%${filter}%`
      )
      .order("name", { ascending: true })
      .range(0, limitPerGroup - 1),
    supabase
      .from("documents")
      .select("id,title,file_name,document_type,uploaded_at,notes")
      .or(
        uuidLike
          ? `id.eq.${filter},title.ilike.%${filter}%,file_name.ilike.%${filter}%,notes.ilike.%${filter}%,document_type.ilike.%${filter}%`
          : `title.ilike.%${filter}%,file_name.ilike.%${filter}%,notes.ilike.%${filter}%,document_type.ilike.%${filter}%`
      )
      .order("uploaded_at", { ascending: false, nullsFirst: false })
      .range(0, limitPerGroup - 1),
    supabase
      .from("properties")
      .select("id,address,is_active")
      .or(uuidLike ? `id.eq.${filter},address.ilike.%${filter}%` : `address.ilike.%${filter}%`)
      .order("address", { ascending: true })
      .range(0, limitPerGroup - 1),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,reference_number,notes,business_domain,project_id,order_id,property_id")
      .or(
        uuidLike
          ? `id.eq.${filter},reference_number.ilike.%${filter}%,notes.ilike.%${filter}%,payment_method.ilike.%${filter}%,business_domain.ilike.%${filter}%`
          : `reference_number.ilike.%${filter}%,notes.ilike.%${filter}%,payment_method.ilike.%${filter}%,business_domain.ilike.%${filter}%`
      )
      .order("payment_date", { ascending: false })
      .range(0, limitPerGroup - 1),
    supabase
      .from("expenses")
      .select("id,expense_date,amount,category,description,notes,business_domain,project_id,order_id,property_id")
      .or(
        uuidLike
          ? `id.eq.${filter},category.ilike.%${filter}%,description.ilike.%${filter}%,notes.ilike.%${filter}%,business_domain.ilike.%${filter}%`
          : `category.ilike.%${filter}%,description.ilike.%${filter}%,notes.ilike.%${filter}%,business_domain.ilike.%${filter}%`
      )
      .order("expense_date", { ascending: false })
      .range(0, limitPerGroup - 1),
    options.viewerRole === "admin"
      ? supabase
          .from("users")
          .select("id,full_name,email,role,active,phone")
          .or(
            uuidLike
              ? `id.eq.${filter},full_name.ilike.%${filter}%,email.ilike.%${filter}%,phone.ilike.%${filter}%`
              : `full_name.ilike.%${filter}%,email.ilike.%${filter}%,phone.ilike.%${filter}%`
          )
          .order("full_name", { ascending: true })
          .range(0, limitPerGroup - 1)
      : Promise.resolve({ data: [], error: null }),
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
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "Global search failed");
  }

  const results = [
    ...(((customersResult.data ?? []) as Row[]).map(customerResult).filter(Boolean) as GlobalSearchResult[]),
    ...(((projectsResult.data ?? []) as Row[]).map(projectResult).filter(Boolean) as GlobalSearchResult[]),
    ...(((tasksResult.data ?? []) as Row[]).map(taskResult).filter(Boolean) as GlobalSearchResult[]),
    ...(((ordersResult.data ?? []) as Row[]).map(orderResult).filter(Boolean) as GlobalSearchResult[]),
    ...(((productsResult.data ?? []) as Row[]).map(productResult).filter(Boolean) as GlobalSearchResult[]),
    ...(((documentsResult.data ?? []) as Row[]).map((row) => documentResult(row, query)).filter(Boolean) as GlobalSearchResult[]),
    ...(((propertiesResult.data ?? []) as Row[]).map(propertyResult).filter(Boolean) as GlobalSearchResult[]),
    ...(((paymentsResult.data ?? []) as Row[]).map(paymentResult).filter(Boolean) as GlobalSearchResult[]),
    ...(((expensesResult.data ?? []) as Row[]).map(expenseResult).filter(Boolean) as GlobalSearchResult[]),
    ...(((usersResult.data ?? []) as Row[]).map(userResult).filter(Boolean) as GlobalSearchResult[]),
  ];

  return {
    query,
    totalResults: results.length,
    groups: buildGroups(results),
  };
}
