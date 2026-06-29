import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";

// ════════════════════════════════════════════════════════════════════════════
// Vehicles (רכבים) — a structured "asset" built on the generic tags backbone.
// A vehicle = one `tags` row (kind='vehicle') + one `vehicles` detail row, and
// it gathers activity through `entity_tags` (expenses / payments / tasks / docs).
// See db/sql/create_tags_and_vehicles.sql.
//
// The TAG id is the vehicle's canonical identity everywhere (routes, rollup,
// entity_tags), because that's what activity links to.
// ════════════════════════════════════════════════════════════════════════════

export type Vehicle = {
  tagId: string; // tags.id — the canonical id used in routes + entity_tags
  name: string;
  color: string | null;
  isActive: boolean;
  notes: string | null;
  licensePlate: string | null;
  makeModel: string | null;
  year: number | null;
  testDueDate: string | null; // טסט
  insuranceDueDate: string | null; // ביטוח
  licenseDueDate: string | null; // רישוי
  ownerName: string | null; // רשום על שם
  createdAt: string | null;
};

export type VehicleRollup = {
  totalExpenseAmount: number; // booked (all tagged expenses)
  paidExpenseAmount: number; // cash actually spent
  totalIncomeAmount: number; // tagged payments
  taskCount: number;
  openTaskCount: number;
  documentCount: number;
};

export type VehicleWithRollup = Vehicle & { rollup: VehicleRollup };

const EMPTY_ROLLUP: VehicleRollup = {
  totalExpenseAmount: 0,
  paidExpenseAmount: 0,
  totalIncomeAmount: 0,
  taskCount: 0,
  openTaskCount: 0,
  documentCount: 0,
};

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

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeVehicle(row: Row): Vehicle {
  const tag = (row.tag ?? {}) as Row; // embedded tags row
  return {
    tagId: str(tag.id) ?? "",
    name: str(tag.name) ?? "רכב",
    color: str(tag.color),
    isActive: tag.is_active !== false,
    notes: str(row.notes) ?? str(tag.notes),
    licensePlate: str(row.license_plate),
    makeModel: str(row.make_model),
    year: intOrNull(row.year),
    testDueDate: str(row.test_due_date),
    insuranceDueDate: str(row.insurance_due_date),
    licenseDueDate: str(row.license_due_date),
    ownerName: str(row.owner_name),
    createdAt: str(tag.created_at),
  };
}

/**
 * Every vehicle with its cost/income rollup. Resilient: returns [] before the
 * SQL has been run or when the caller lacks access (mirrors fetchLoans).
 */
export async function fetchVehicles(supabase: SupabaseClient): Promise<VehicleWithRollup[]> {
  try {
    let data: Row[];
    try {
      data = await fetchAllPaged<Row>((lo, hi) =>
        supabase
          .from("vehicles")
          .select(
            "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,tag:tags!inner(id,name,color,is_active,notes,created_at)"
          )
          .eq("tag.kind", "vehicle")
          .range(lo, hi)
      );
    } catch {
      return [];
    }

    const vehicles = data.map(normalizeVehicle).filter((v) => v.tagId);

    // One global rollup call (SECURITY DEFINER → not per-role). Keyed by tag_id.
    const rollupByTag = new Map<string, VehicleRollup>();
    const { data: rollupData } = await supabase.rpc("tag_rollup");
    for (const r of (rollupData ?? []) as Row[]) {
      const id = str(r.tag_id);
      if (!id) continue;
      rollupByTag.set(id, {
        totalExpenseAmount: num(r.total_expense_amount),
        paidExpenseAmount: num(r.paid_expense_amount),
        totalIncomeAmount: num(r.total_income_amount),
        taskCount: num(r.task_count),
        openTaskCount: num(r.open_task_count),
        documentCount: num(r.document_count),
      });
    }

    return vehicles
      .map((v) => ({ ...v, rollup: rollupByTag.get(v.tagId) ?? EMPTY_ROLLUP }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
  } catch {
    return [];
  }
}

export async function fetchVehicle(
  supabase: SupabaseClient,
  tagId: string
): Promise<Vehicle | null> {
  try {
    const { data, error } = await supabase
      .from("vehicles")
      .select(
        "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,tag:tags!inner(id,name,color,is_active,notes,created_at)"
      )
      .eq("tag_id", tagId)
      .maybeSingle();
    if (error || !data) return null;
    const v = normalizeVehicle(data as Row);
    return v.tagId ? v : null;
  } catch {
    return null;
  }
}

// ── Per-vehicle activity (the detail page) ──────────────────────────────────

export type VehicleExpense = {
  id: string;
  date: string | null;
  amount: number;
  category: string | null;
  description: string | null;
  paymentStatus: string | null;
  // extra fields so the edit dialog can be pre-filled accurately
  businessDomain: string | null;
  notes: string | null;
  paymentMethod: string | null;
  accountId: string | null;
  paidAmount: number | null;
  projectId: string | null;
  orderId: string | null;
  propertyId: string | null;
};
export type VehiclePayment = {
  id: string;
  date: string | null;
  amount: number;
  method: string | null;
  projectId: string | null; // null = standalone income (deletable from here)
};
export type VehicleTask = {
  id: string;
  subject: string | null;
  status: string | null;
  dueDate: string | null;
};
export type VehicleDocument = {
  id: string;
  title: string | null;
  fileName: string | null;
  documentType: string | null;
  uploadedAt: string | null;
  refYear: number | null; // the year this file is FOR (e.g. a 2026 טסט)
};

export type VehicleActivity = {
  expenses: VehicleExpense[];
  payments: VehiclePayment[];
  tasks: VehicleTask[];
  documents: VehicleDocument[];
  rollup: VehicleRollup;
};

const OPEN_TASK_STATUSES = (status: string | null) =>
  !["done", "cancelled"].includes(status ?? "todo");

/**
 * Pull everything tagged to one vehicle and compute its rollup in JS (so the
 * detail page needs no RPC). Resilient: missing tables/links → empty sections.
 */
export async function fetchVehicleActivity(
  supabase: SupabaseClient,
  tagId: string
): Promise<VehicleActivity> {
  const empty: VehicleActivity = {
    expenses: [],
    payments: [],
    tasks: [],
    documents: [],
    rollup: EMPTY_ROLLUP,
  };
  try {
    const links = await fetchAllPaged<Row>((lo, hi) =>
      supabase.from("entity_tags").select("entity_type,entity_id,ref_year").eq("tag_id", tagId).range(lo, hi)
    );

    const idsBy = { expense: [] as string[], payment: [] as string[], task: [] as string[], document: [] as string[] };
    const refYearByDoc = new Map<string, number | null>();
    for (const row of links) {
      const type = str(row.entity_type);
      const id = str(row.entity_id);
      if (!type || !id) continue;
      if (type in idsBy) (idsBy as Record<string, string[]>)[type].push(id);
      if (type === "document") refYearByDoc.set(id, intOrNull(row.ref_year));
    }

    const [exRes, pmRes, tkRes, dcRes] = await Promise.all([
      idsBy.expense.length
        ? supabase
            .from("expenses")
            .select(
              "id,expense_date,amount,category,description,payment_status,paid_amount,business_domain,notes,payment_method,account_id,project_id,order_id,property_id"
            )
            .in("id", idsBy.expense)
        : Promise.resolve({ data: [] as Row[] }),
      idsBy.payment.length
        ? supabase
            .from("payments")
            .select("id,payment_date,amount_total,payment_method,project_id")
            .in("id", idsBy.payment)
        : Promise.resolve({ data: [] as Row[] }),
      idsBy.task.length
        ? supabase.from("tasks").select("id,subject,status,due_date").in("id", idsBy.task)
        : Promise.resolve({ data: [] as Row[] }),
      idsBy.document.length
        ? supabase
            .from("documents")
            .select("id,title,file_name,document_type,uploaded_at")
            .in("id", idsBy.document)
        : Promise.resolve({ data: [] as Row[] }),
    ]);

    const expenses: VehicleExpense[] = ((exRes.data ?? []) as Row[]).map((r) => ({
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
    const payments: VehiclePayment[] = ((pmRes.data ?? []) as Row[]).map((r) => ({
      id: str(r.id) ?? "",
      date: str(r.payment_date),
      amount: num(r.amount_total),
      method: str(r.payment_method),
      projectId: str(r.project_id),
    }));
    const tasks: VehicleTask[] = ((tkRes.data ?? []) as Row[]).map((r) => ({
      id: str(r.id) ?? "",
      subject: str(r.subject),
      status: str(r.status),
      dueDate: str(r.due_date),
    }));
    const documents: VehicleDocument[] = ((dcRes.data ?? []) as Row[]).map((r) => ({
      id: str(r.id) ?? "",
      title: str(r.title),
      fileName: str(r.file_name),
      documentType: str(r.document_type),
      uploadedAt: str(r.uploaded_at),
      refYear: refYearByDoc.get(str(r.id) ?? "") ?? null,
    }));

    // Newest-first for the timeline-style lists.
    expenses.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    payments.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    documents.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));

    const paidExpenseAmount = ((exRes.data ?? []) as Row[]).reduce(
      (sum, r) =>
        sum + (str(r.payment_status) === "paid" ? num(r.amount) : num(r.paid_amount)),
      0
    );
    const rollup: VehicleRollup = {
      totalExpenseAmount: expenses.reduce((s, e) => s + e.amount, 0),
      paidExpenseAmount,
      totalIncomeAmount: payments.reduce((s, p) => s + p.amount, 0),
      taskCount: tasks.length,
      openTaskCount: tasks.filter((t) => OPEN_TASK_STATUSES(t.status)).length,
      documentCount: documents.length,
    };

    return { expenses, payments, tasks, documents, rollup };
  } catch {
    return empty;
  }
}

// ── Expiry helpers (טסט / ביטוח / רישוי) → badge tone ────────────────────────

export type ExpiryTone = "destructive" | "warning" | "success";
export type ExpiryStatus = { tone: ExpiryTone; label: string; days: number } | null;

/** Days until a due date; <0 expired (red), <=30 expiring (amber), else valid (green). */
export function expiryStatus(dueDate: string | null): ExpiryStatus {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { tone: "destructive", label: `פג לפני ${Math.abs(days)} ימים`, days };
  if (days <= 30) return { tone: "warning", label: days === 0 ? "פג היום" : `בעוד ${days} ימים`, days };
  return { tone: "success", label: "בתוקף", days };
}

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
