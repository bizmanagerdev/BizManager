import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { STORAGE_BUCKET } from "@/lib/storage";
import type { WorkSessionRow } from "@/lib/payroll";

// ════════════════════════════════════════════════════════════════════════════
// Properties (נכסים) — a real estate asset with a lease history and its own
// income/expenses. Unlike vehicles (a generic tag), a property is linked via a
// direct `property_id` FK column already present on `expenses`/`payments`/
// `tasks`, so no tag/RPC rollup indirection is needed — the totals are summed
// straight from those tables.
// ════════════════════════════════════════════════════════════════════════════

export type Property = {
  id: string;
  name: string | null;
  address: string;
  assetDescription: string | null;
  isActive: boolean;
  rooms: number | null;
  squareMeters: number | null;
  floor: number | null;
  bathrooms: number | null;
  hasPrivateEntrance: boolean;
  hasStorageRoom: boolean;
  hasParking: boolean;
  hasElevator: boolean;
  purchasedFrom: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchaseTax: number | null;
  landBlock: string | null;
  landParcel: string | null;
  landSubParcel: string | null;
  isFurnished: boolean;
  furnitureItems: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

/** The label to show for a property everywhere in the app: its name if set,
 *  else its address (every property has an address; not every one has a name yet). */
export function propertyDisplayName(property: { name?: string | null; address: string }): string {
  return property.name?.trim() || property.address;
}

export type LeaseAgreement = {
  id: string;
  propertyId: string;
  customerId: string;
  customerName: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyRentAmount: number;
  documentId: string | null;
  documentFileName: string | null;
  documentUrl: string | null;
  status: string | null;
  notes: string | null;
  depositType: string | null;
  depositAmount: number | null;
  depositReference: string | null;
  createdAt: string | null;
};

export type PropertyRollup = {
  totalExpenseAmount: number;
  paidExpenseAmount: number;
  totalIncomeAmount: number;
};

const EMPTY_ROLLUP: PropertyRollup = { totalExpenseAmount: 0, paidExpenseAmount: 0, totalIncomeAmount: 0 };

export type PropertyWithLease = Property & {
  currentLease: LeaseAgreement | null;
  rollup: PropertyRollup;
};

export type PropertyWithLeases = Property & { leases: LeaseAgreement[] };

type Row = Record<string, unknown>;

function num(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** collected = cleared or null/legacy; pending/rejected checks are NOT money in
 *  hand yet (matches lib/orders/paymentStatus.ts's isCollectedPayment convention). */
function isCollectedPaymentStatus(status: string | null) {
  return status !== "pending" && status !== "rejected";
}

function normalizeProperty(row: Row): Property {
  return {
    id: str(row.id) ?? "",
    name: str(row.name),
    address: str(row.address) ?? "",
    assetDescription: str(row.asset_description),
    isActive: row.is_active !== false,
    rooms: numOrNull(row.rooms),
    squareMeters: numOrNull(row.square_meters),
    floor: numOrNull(row.floor),
    bathrooms: numOrNull(row.bathrooms),
    hasPrivateEntrance: row.has_private_entrance === true,
    hasStorageRoom: row.has_storage_room === true,
    hasParking: row.has_parking === true,
    hasElevator: row.has_elevator === true,
    purchasedFrom: str(row.purchased_from),
    purchaseDate: str(row.purchase_date),
    purchasePrice: numOrNull(row.purchase_price),
    purchaseTax: numOrNull(row.purchase_tax),
    landBlock: str(row.land_block),
    landParcel: str(row.land_parcel),
    landSubParcel: str(row.land_sub_parcel),
    isFurnished: row.is_furnished === true,
    furnitureItems: Array.isArray(row.furniture_items)
      ? row.furniture_items.filter((x): x is string => typeof x === "string")
      : [],
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

function normalizeLease(row: Row): LeaseAgreement {
  const customer = (row.customer ?? {}) as Row | Row[];
  const customerRow = Array.isArray(customer) ? customer[0] : customer;
  return {
    id: str(row.id) ?? "",
    propertyId: str(row.property_id) ?? "",
    customerId: str(row.customer_id) ?? "",
    customerName: str(customerRow?.name),
    startDate: str(row.start_date),
    endDate: str(row.end_date),
    monthlyRentAmount: num(row.monthly_rent_amount),
    documentId: str(row.document_id),
    documentFileName: null,
    documentUrl: null,
    status: str(row.status),
    notes: str(row.notes),
    depositType: str(row.deposit_type),
    depositAmount: numOrNull(row.deposit_amount),
    depositReference: str(row.deposit_reference),
    createdAt: str(row.created_at),
  };
}

/** Resolve signed view URLs for every lease's attached signed-agreement document. */
async function attachLeaseDocumentUrls(
  supabase: SupabaseClient,
  leases: LeaseAgreement[]
): Promise<LeaseAgreement[]> {
  const docIds = Array.from(new Set(leases.map((l) => l.documentId).filter((id): id is string => Boolean(id))));
  if (docIds.length === 0) return leases;
  try {
    const { data: docs } = await supabase.from("documents").select("id,file_name,storage_key").in("id", docIds);
    const fileNameById = new Map<string, string | null>();
    const keyById = new Map<string, string>();
    for (const row of (docs ?? []) as Row[]) {
      const id = str(row.id);
      if (!id) continue;
      fileNameById.set(id, str(row.file_name));
      const key = str(row.storage_key);
      if (key) keyById.set(id, key);
    }
    const keys = Array.from(keyById.values());
    const urlByKey = new Map<string, string>();
    if (keys.length > 0) {
      const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(keys, 60 * 60);
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) urlByKey.set(s.path, s.signedUrl);
      }
    }
    return leases.map((lease) => {
      if (!lease.documentId) return lease;
      const key = keyById.get(lease.documentId);
      return {
        ...lease,
        documentFileName: fileNameById.get(lease.documentId) ?? null,
        documentUrl: key ? urlByKey.get(key) ?? null : null,
      };
    });
  } catch {
    return leases;
  }
}

export function leaseStatusLabel(status: string | null): string {
  switch (status) {
    case "active":
      return "פעיל";
    case "ended":
      return "הסתיים";
    case "cancelled":
      return "בוטל";
    default:
      return status ?? "—";
  }
}

export function depositTypeLabel(type: string | null): string {
  switch (type) {
    case "cash":
      return "פיקדון כספי";
    case "bank_guarantee":
      return "ערבות בנקאית";
    case "security_check":
      return "צ'ק ביטחון";
    default:
      return type ?? "";
  }
}

/**
 * Prefer an active lease with no end_date or a future/today end_date; else the
 * most recently started lease of any status. Ties broken by start_date desc.
 */
export function pickCurrentLease(leases: LeaseAgreement[]): LeaseAgreement | null {
  if (leases.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...leases].sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  const openActive = sorted.find(
    (lease) => lease.status === "active" && (!lease.endDate || lease.endDate >= today)
  );
  return openActive ?? sorted[0];
}

const LEASE_SELECT =
  "id,property_id,customer_id,start_date,end_date,monthly_rent_amount,document_id,status,notes,deposit_type,deposit_amount,deposit_reference,created_at,customer:customers(name)";

/**
 * Every property with its current lease + income/expense rollup, computed in
 * JS from expenses/payments filtered by property_id. Resilient: returns []
 * before RLS is unlocked or on any error (mirrors fetchVehicles/fetchLoans).
 */
export async function fetchProperties(supabase: SupabaseClient): Promise<PropertyWithLease[]> {
  try {
    const properties = (
      await fetchAllPaged<Row>((lo, hi) =>
        supabase
          .from("properties")
          .select(
        "id,name,address,asset_description,is_active,rooms,square_meters,floor,bathrooms,has_private_entrance,has_storage_room,has_parking,has_elevator,purchased_from,purchase_date,purchase_price,purchase_tax,land_block,land_parcel,land_sub_parcel,is_furnished,furniture_items,created_at,updated_at"
      )
          .range(lo, hi)
      )
    ).map(normalizeProperty);
    const ids = properties.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) return [];

    const [leaseRows, expenseRows, paymentRows, sessionRows] = await Promise.all([
      fetchAllPaged<Row>((lo, hi) =>
        supabase.from("lease_agreements").select(LEASE_SELECT).in("property_id", ids).range(lo, hi)
      ),
      fetchAllPaged<Row>((lo, hi) =>
        supabase
          .from("expenses")
          .select("property_id,amount,payment_status,paid_amount")
          .in("property_id", ids)
          .range(lo, hi)
      ),
      fetchAllPaged<Row>((lo, hi) =>
        supabase
          .from("payments")
          .select("property_id,amount_total,payment_status")
          .in("property_id", ids)
          .range(lo, hi)
      ),
      fetchAllPaged<Row>((lo, hi) =>
        supabase.from("attendance_sessions").select("property_id,labor_cost").in("property_id", ids).range(lo, hi)
      ),
    ]);

    const leasesByProperty = new Map<string, LeaseAgreement[]>();
    for (const row of leaseRows) {
      const lease = normalizeLease(row);
      if (!lease.propertyId) continue;
      const list = leasesByProperty.get(lease.propertyId) ?? [];
      list.push(lease);
      leasesByProperty.set(lease.propertyId, list);
    }

    const rollupByProperty = new Map<string, PropertyRollup>();
    function rollupFor(propertyId: string) {
      const existing = rollupByProperty.get(propertyId);
      if (existing) return existing;
      const created = { totalExpenseAmount: 0, paidExpenseAmount: 0, totalIncomeAmount: 0 };
      rollupByProperty.set(propertyId, created);
      return created;
    }
    for (const row of expenseRows) {
      const propertyId = str(row.property_id);
      if (!propertyId) continue;
      const rollup = rollupFor(propertyId);
      rollup.totalExpenseAmount += num(row.amount);
      rollup.paidExpenseAmount += str(row.payment_status) === "paid" ? num(row.amount) : num(row.paid_amount);
    }
    for (const row of paymentRows) {
      const propertyId = str(row.property_id);
      if (!propertyId) continue;
      if (!isCollectedPaymentStatus(str(row.payment_status))) continue;
      rollupFor(propertyId).totalIncomeAmount += num(row.amount_total);
    }
    // Worker labor cost counts as a real expense the moment the shift happens —
    // same unconditional rule fetchPropertyActivity uses (see its own comment).
    for (const row of sessionRows) {
      const propertyId = str(row.property_id);
      if (!propertyId) continue;
      const laborCost = Math.max(0, num(row.labor_cost));
      const rollup = rollupFor(propertyId);
      rollup.totalExpenseAmount += laborCost;
      rollup.paidExpenseAmount += laborCost;
    }

    return properties
      .map((property) => ({
        ...property,
        currentLease: pickCurrentLease(leasesByProperty.get(property.id) ?? []),
        rollup: rollupByProperty.get(property.id) ?? EMPTY_ROLLUP,
      }))
      .sort((a, b) => propertyDisplayName(a).localeCompare(propertyDisplayName(b), "he"));
  } catch {
    return [];
  }
}

/** One property + its FULL lease history (newest start_date first). */
export async function fetchProperty(
  supabase: SupabaseClient,
  id: string
): Promise<PropertyWithLeases | null> {
  try {
    const { data, error } = await supabase
      .from("properties")
      .select(
        "id,name,address,asset_description,is_active,rooms,square_meters,floor,bathrooms,has_private_entrance,has_storage_room,has_parking,has_elevator,purchased_from,purchase_date,purchase_price,purchase_tax,land_block,land_parcel,land_sub_parcel,is_furnished,furniture_items,created_at,updated_at"
      )
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;

    const { data: leaseRows } = await supabase.from("lease_agreements").select(LEASE_SELECT).eq("property_id", id);
    const leases = await attachLeaseDocumentUrls(
      supabase,
      ((leaseRows ?? []) as Row[])
        .map(normalizeLease)
        .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))
    );

    return { ...normalizeProperty(data as Row), leases };
  } catch {
    return null;
  }
}

// ── Per-property activity (the detail page) ─────────────────────────────────

export type PropertyExpense = {
  id: string;
  date: string | null;
  amount: number;
  category: string | null;
  description: string | null;
  paymentStatus: string | null;
  businessDomain: string | null;
  notes: string | null;
  paymentMethod: string | null;
  accountId: string | null;
  paidAmount: number | null;
  projectId: string | null;
  orderId: string | null;
  propertyId: string | null;
};

export type PropertyPayment = {
  id: string;
  date: string | null;
  amount: number;
  method: string | null;
  dueDate: string | null;
  checkNumber: string | null;
  paymentStatus: string | null;
};

export type PropertyDocument = {
  id: string;
  title: string | null;
  fileName: string | null;
  documentType: string | null;
  uploadedAt: string | null;
  url: string | null;
};

export type PropertyTask = {
  id: string;
  subject: string | null;
  status: string | null;
  dueDate: string | null;
};

/**
 * A property-linked shift IS a `WorkSessionRow` — the exact shape
 * `ExpenseDialog`'s `editingSession` prop expects for admin edit/delete, so no
 * lossy camelCase transform happens here (unlike the rest of this file's
 * Property* types, which normalize snake_case DB rows into the app's own
 * convention). Kept as its own alias so property code doesn't import
 * `lib/payroll` directly at every call site.
 */
export type PropertySession = WorkSessionRow;

export function taskStatusLabel(status: string | null): string {
  switch (status) {
    case "in_progress":
      return "בתהליך";
    case "blocked":
      return "תקוע";
    case "done":
      return "הושלם";
    case "cancelled":
      return "בוטל";
    default:
      return "לביצוע";
  }
}

export type PropertyRecurringTemplate = {
  id: string;
  templateName: string | null;
  category: string | null;
  amount: number | null;
  isVariableAmount: boolean;
  autoPaid: boolean;
  reminderWorkDaysBefore: number | null;
  descriptionTemplate: string | null;
  notesTemplate: string | null;
  businessDomain: string | null;
  accountId: string | null;
  frequency: "monthly" | "yearly";
  intervalMonths: number;
  expenseDayOfMonth: number;
  expenseMonthOfYear: number | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
};

export function recurringFrequencyLabel(t: PropertyRecurringTemplate): string {
  if (t.frequency === "yearly") return "פעם בשנה";
  if (t.intervalMonths > 1) return `כל ${t.intervalMonths} חודשים`;
  return "כל חודש";
}

function normalizeRecurringTemplate(row: Row): PropertyRecurringTemplate {
  const frequency = str(row.frequency) === "yearly" ? "yearly" : "monthly";
  return {
    id: str(row.id) ?? "",
    templateName: str(row.template_name),
    category: str(row.category),
    amount: numOrNull(row.amount),
    isVariableAmount: row.is_variable_amount === true,
    autoPaid: row.auto_paid === true,
    reminderWorkDaysBefore: numOrNull(row.reminder_work_days_before),
    descriptionTemplate: str(row.description_template),
    notesTemplate: str(row.notes_template),
    businessDomain: str(row.business_domain),
    accountId: str(row.account_id),
    frequency,
    intervalMonths: numOrNull(row.interval_months) ?? 1,
    expenseDayOfMonth: numOrNull(row.expense_day_of_month) ?? 1,
    expenseMonthOfYear: numOrNull(row.expense_month_of_year),
    startDate: str(row.start_date),
    endDate: str(row.end_date),
    isActive: row.is_active !== false,
  };
}

const RECURRING_TEMPLATE_SELECT =
  "id,template_name,category,amount,is_variable_amount,auto_paid,reminder_work_days_before,description_template,notes_template,business_domain,account_id,frequency,interval_months,expense_day_of_month,expense_month_of_year,start_date,end_date,is_active";

export type PropertyActivity = {
  expenses: PropertyExpense[];
  payments: PropertyPayment[];
  documents: PropertyDocument[];
  tasks: PropertyTask[];
  recurringTemplates: PropertyRecurringTemplate[];
  sessions: PropertySession[];
  rollup: PropertyRollup;
};

/**
 * Expenses/payments queried directly by property_id (a real FK column — no
 * entity_tags indirection needed, unlike vehicles). Documents via
 * document_links(entity_type='property'), mirroring the project detail page's
 * document-link pattern. Resilient: empty sections on any error.
 */
export async function fetchPropertyActivity(
  supabase: SupabaseClient,
  propertyId: string
): Promise<PropertyActivity> {
  const empty: PropertyActivity = {
    expenses: [],
    payments: [],
    documents: [],
    tasks: [],
    recurringTemplates: [],
    sessions: [],
    rollup: EMPTY_ROLLUP,
  };
  try {
    const [exRes, pmRes, linkRes, tkRes, rtRes, ssRes] = await Promise.all([
      supabase
        .from("expenses")
        .select(
          "id,expense_date,amount,category,description,payment_status,paid_amount,business_domain,notes,payment_method,account_id,project_id,order_id,property_id"
        )
        .eq("property_id", propertyId),
      supabase
        .from("payments")
        .select("id,payment_date,amount_total,payment_method,due_date,check_number,payment_status")
        .eq("property_id", propertyId),
      supabase.from("document_links").select("document_id").eq("entity_type", "property").eq("entity_id", propertyId),
      supabase.from("tasks").select("id,subject,status,due_date").eq("property_id", propertyId),
      supabase.from("recurring_expense_templates").select(RECURRING_TEMPLATE_SELECT).eq("property_id", propertyId),
      supabase
        .from("attendance_sessions")
        .select(
          "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
        )
        .eq("property_id", propertyId),
    ]);

    const docIds = ((linkRes.data ?? []) as Row[])
      .map((row) => str(row.document_id))
      .filter((id): id is string => Boolean(id));
    const { data: docRows } = docIds.length
      ? await supabase
          .from("documents")
          .select("id,title,file_name,document_type,uploaded_at,storage_key")
          .in("id", docIds)
      : { data: [] as Row[] };

    const docKeys = ((docRows ?? []) as Row[])
      .map((row) => str(row.storage_key))
      .filter((key): key is string => Boolean(key));
    const docUrlByKey = new Map<string, string>();
    if (docKeys.length > 0) {
      const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(docKeys, 60 * 60);
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) docUrlByKey.set(s.path, s.signedUrl);
      }
    }

    const expenses: PropertyExpense[] = ((exRes.data ?? []) as Row[]).map((r) => ({
      id: str(r.id) ?? "",
      date: str(r.expense_date),
      amount: num(r.amount),
      category: str(r.category),
      description: str(r.description),
      paymentStatus: str(r.payment_status),
      businessDomain: str(r.business_domain),
      notes: str(r.notes),
      paymentMethod: str(r.payment_method),
      accountId: str(r.account_id),
      paidAmount: r.paid_amount == null ? null : num(r.paid_amount),
      projectId: str(r.project_id),
      orderId: str(r.order_id),
      propertyId: str(r.property_id),
    }));
    const payments: PropertyPayment[] = ((pmRes.data ?? []) as Row[]).map((r) => ({
      id: str(r.id) ?? "",
      date: str(r.payment_date),
      amount: num(r.amount_total),
      method: str(r.payment_method),
      dueDate: str(r.due_date),
      checkNumber: str(r.check_number),
      paymentStatus: str(r.payment_status),
    }));
    const documents: PropertyDocument[] = ((docRows ?? []) as Row[]).map((r) => {
      const key = str(r.storage_key);
      return {
        id: str(r.id) ?? "",
        title: str(r.title),
        fileName: str(r.file_name),
        documentType: str(r.document_type),
        uploadedAt: str(r.uploaded_at),
        url: key ? docUrlByKey.get(key) ?? null : null,
      };
    });
    const tasks: PropertyTask[] = ((tkRes.data ?? []) as Row[]).map((r) => ({
      id: str(r.id) ?? "",
      subject: str(r.subject),
      status: str(r.status),
      dueDate: str(r.due_date),
    }));
    const recurringTemplates: PropertyRecurringTemplate[] = ((rtRes.data ?? []) as Row[]).map(normalizeRecurringTemplate);
    // Kept as raw WorkSessionRow shape — see the PropertySession alias comment.
    const sessions: PropertySession[] = (ssRes.data ?? []) as PropertySession[];

    expenses.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    payments.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    documents.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
    tasks.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
    recurringTemplates.sort((a, b) => (a.templateName ?? "").localeCompare(b.templateName ?? "", "he"));
    sessions.sort((a, b) => b.clock_in.localeCompare(a.clock_in));

    const paidExpenseAmount = ((exRes.data ?? []) as Row[]).reduce(
      (sum, r) => sum + (str(r.payment_status) === "paid" ? num(r.amount) : num(r.paid_amount)),
      0
    );
    // Worker labor on this property is a real cost the moment the shift happens
    // — counted in full here regardless of whether the worker has since been
    // paid via payroll (that's tracked separately). Mirrors how
    // project_financials_view folds attendance_sessions.labor_cost into
    // total_expenses unconditionally.
    const sessionLaborTotal = sessions.reduce((s, x) => s + Math.max(0, num(x.labor_cost)), 0);
    const rollup: PropertyRollup = {
      totalExpenseAmount: expenses.reduce((s, e) => s + e.amount, 0) + sessionLaborTotal,
      paidExpenseAmount: paidExpenseAmount + sessionLaborTotal,
      totalIncomeAmount: payments
        .filter((p) => isCollectedPaymentStatus(p.paymentStatus))
        .reduce((s, p) => s + p.amount, 0),
    };

    return { expenses, payments, documents, tasks, recurringTemplates, sessions, rollup };
  } catch {
    return empty;
  }
}

// ── Dashboard card summary ──────────────────────────────────────────────────

export type PropertiesSummary = {
  vacant: { id: string; label: string }[];
  vacantCount: number;
  expiring: { id: string; propertyId: string; label: string; tenantName: string | null; endDate: string; daysLeft: number }[];
  expiringCount: number;
};

const EMPTY_PROPERTIES_SUMMARY: PropertiesSummary = { vacant: [], vacantCount: 0, expiring: [], expiringCount: 0 };

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is in the past). */
function daysUntil(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * The "נכסים" dashboard card's data, in two narrow queries — deliberately NOT
 * fetchProperties(), which also pulls the full expense/payment rollup a card
 * never shows (mirrors getCollectionsSummary's own reasoning in lib/collections.ts).
 * A property is vacant when none of its leases is currently open (no end_date,
 * or an end_date that hasn't arrived yet); "expiring" is any ACTIVE lease whose
 * end_date falls within 60 days — a wider, quieter monitoring window than the
 * 30-day lease_expiry reminder rule, which is meant to actually nag.
 */
export async function getPropertiesSummary(
  supabase: SupabaseClient,
  todayIso?: string
): Promise<PropertiesSummary> {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 60);
  const horizonIso = horizon.toISOString().slice(0, 10);
  try {
    const [propsRes, leasesRes] = await Promise.all([
      supabase.from("properties").select("id,name,address").eq("is_active", true),
      supabase
        .from("lease_agreements")
        .select("id,property_id,customer_id,end_date,status,customer:customers(name)")
        .eq("status", "active"),
    ]);
    if (propsRes.error) return EMPTY_PROPERTIES_SUMMARY;

    const properties = (propsRes.data ?? []) as Row[];
    const leases = (leasesRes.data ?? []) as Row[];
    const labelById = new Map<string, string>();
    for (const p of properties) {
      const id = str(p.id);
      if (id) labelById.set(id, str(p.name) || str(p.address) || "נכס");
    }

    const leasesByProperty = new Map<string, Row[]>();
    for (const l of leases) {
      const propertyId = str(l.property_id);
      if (!propertyId) continue;
      const list = leasesByProperty.get(propertyId) ?? [];
      list.push(l);
      leasesByProperty.set(propertyId, list);
    }

    const vacant = properties
      .map((p) => str(p.id))
      .filter((id): id is string => Boolean(id))
      .filter((id) => {
        const propertyLeases = leasesByProperty.get(id) ?? [];
        return !propertyLeases.some((l) => {
          const end = str(l.end_date);
          return !end || end >= today;
        });
      })
      .map((id) => ({ id, label: labelById.get(id) ?? "נכס" }));

    const expiring = leases
      .filter((l) => {
        const end = str(l.end_date);
        return Boolean(end && end <= horizonIso);
      })
      .map((l) => {
        const propertyId = str(l.property_id) ?? "";
        const customer = (Array.isArray(l.customer) ? l.customer[0] : l.customer) as Row | undefined;
        const endDate = str(l.end_date) ?? "";
        return {
          id: str(l.id) ?? "",
          propertyId,
          label: labelById.get(propertyId) ?? "נכס",
          tenantName: str(customer?.name),
          endDate,
          daysLeft: daysUntil(today, endDate),
        };
      })
      .sort((a, b) => a.endDate.localeCompare(b.endDate));

    return { vacant, vacantCount: vacant.length, expiring, expiringCount: expiring.length };
  } catch {
    return EMPTY_PROPERTIES_SUMMARY;
  }
}
