import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { STORAGE_BUCKET } from "@/lib/storage";

// ════════════════════════════════════════════════════════════════════════════
// Vehicles (רכבים) — a structured "asset" built on the generic tags backbone.
// A vehicle = one `tags` row (kind='vehicle') + one `vehicles` detail row, and
// it gathers activity through `entity_tags` (expenses / payments / tasks / docs).
// See db/sql/create_tags_and_vehicles.sql.
//
// The TAG id is the vehicle's canonical identity everywhere (routes, rollup,
// entity_tags), because that's what activity links to.
// ════════════════════════════════════════════════════════════════════════════

/** The task that led to an expiry date update ("did the טסט") — resolved for display/linking. */
export type VehicleSourceTask = { id: string; subject: string | null; status: string | null } | null;

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
  photoDocumentId: string | null; // FK to documents — the car's single cover photo, not a gallery
  photoUrl: string | null; // resolved signed URL (short-lived; see resolveVehiclePhotoUrls)
  // ק"מ — a denormalized cache of the LATEST row in vehicle_mileage_readings,
  // kept in sync by that table's trigger (see 20260907131007). Never written
  // directly through updateVehicle/VehicleInput — a bare number with no date
  // is exactly the thing this log replaced. mileageUpdatedAt is the reading's
  // own date (not "when someone last touched the vehicle"), for the
  // "לפני X ימים" / stale styling on the detail page's mileage card.
  mileage: number | null;
  mileageUpdatedAt: string | null;
  // Only resolved by fetchVehicle (the detail page) — fetchVehicles (the fleet
  // list) leaves these null, the list card has no room/need for the link.
  testSourceTask: VehicleSourceTask;
  insuranceSourceTask: VehicleSourceTask;
  licenseSourceTask: VehicleSourceTask;
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

// ── Shared create/edit form shape — used by both the vehicles list dialog
// and the detail page's own edit affordance, so they never drift apart. ──
export type VehicleInput = {
  name: string;
  license_plate: string;
  make_model: string;
  year: string; // raw from the input; parsed by the server action
  test_due_date: string;
  insurance_due_date: string;
  license_due_date: string;
  owner_name: string;
  color: string;
  notes: string;
  // Empty string = no link. Only VehicleExpiryQuickEditDialog exposes an input
  // for these; the general edit form (VehicleFormFields) has none, so
  // vehicleToForm()'s round-trip is what preserves an existing link when the
  // full form is submitted instead.
  test_source_task_id: string;
  insurance_source_task_id: string;
  license_source_task_id: string;
};

export const EMPTY_VEHICLE_FORM: VehicleInput = {
  name: "",
  license_plate: "",
  make_model: "",
  year: "",
  test_due_date: "",
  insurance_due_date: "",
  license_due_date: "",
  owner_name: "",
  color: "",
  notes: "",
  test_source_task_id: "",
  insurance_source_task_id: "",
  license_source_task_id: "",
};

export function vehicleToForm(v: Vehicle): VehicleInput {
  return {
    name: v.name ?? "",
    license_plate: v.licensePlate ?? "",
    make_model: v.makeModel ?? "",
    year: v.year ? String(v.year) : "",
    test_due_date: v.testDueDate ?? "",
    insurance_due_date: v.insuranceDueDate ?? "",
    license_due_date: v.licenseDueDate ?? "",
    owner_name: v.ownerName ?? "",
    color: v.color ?? "",
    notes: v.notes ?? "",
    test_source_task_id: v.testSourceTask?.id ?? "",
    insurance_source_task_id: v.insuranceSourceTask?.id ?? "",
    license_source_task_id: v.licenseSourceTask?.id ?? "",
  };
}

function deriveVehicleName(input: VehicleInput): string {
  const explicit = input.name.trim();
  if (explicit) return explicit;
  const parts = [input.make_model.trim(), input.license_plate.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : "רכב";
}

/** Optimistic patch shown during the undo grace window — mirrors actions.ts's server-side deriveName/vehicleFields. */
export function buildVehiclePatch(input: VehicleInput): Partial<Vehicle> {
  const yearNum = Number(input.year);
  return {
    name: deriveVehicleName(input),
    licensePlate: input.license_plate.trim() || null,
    makeModel: input.make_model.trim() || null,
    year: Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2100 ? yearNum : null,
    testDueDate: input.test_due_date.trim() || null,
    insuranceDueDate: input.insurance_due_date.trim() || null,
    licenseDueDate: input.license_due_date.trim() || null,
    ownerName: input.owner_name.trim() || null,
    notes: input.notes.trim() || null,
    // mileage/mileageUpdatedAt are NOT here on purpose — this form has no
    // field for them (see the VehicleInput comment above); leaving them out
    // of the patch means the undo-overlay's shallow merge keeps whatever the
    // mileage card's own optimistic patch already set, instead of clobbering
    // it back to the pre-edit cached value.
  };
}

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
    photoDocumentId: str(row.photo_document_id),
    photoUrl: null,
    mileage: intOrNull(row.mileage),
    mileageUpdatedAt: str(row.mileage_updated_at),
    // Resolved below by resolveVehicleSourceTasks (fetchVehicle only) — a
    // default of null here is exactly right for fetchVehicles (the fleet
    // list), which never calls it.
    testSourceTask: null,
    insuranceSourceTask: null,
    licenseSourceTask: null,
  };
}

/**
 * Batch-resolve every vehicle's cover photo to a short-lived signed URL — ONE
 * `documents` lookup + ONE storage `createSignedUrls` call regardless of fleet
 * size (mirrors lib/properties.ts's attachLeaseDocumentUrls). Resilient: any
 * failure just leaves photoUrl null instead of breaking the page.
 */
async function resolveVehiclePhotoUrls<T extends Vehicle>(supabase: SupabaseClient, vehicles: T[]): Promise<T[]> {
  const docIds = Array.from(new Set(vehicles.map((v) => v.photoDocumentId).filter((id): id is string => Boolean(id))));
  if (docIds.length === 0) return vehicles;
  try {
    const { data: docs } = await supabase.from("documents").select("id,storage_key").in("id", docIds);
    const keyByDocId = new Map<string, string>();
    for (const row of (docs ?? []) as Row[]) {
      const id = str(row.id);
      const key = str(row.storage_key);
      if (id && key) keyByDocId.set(id, key);
    }
    const keys = Array.from(new Set(keyByDocId.values()));
    const urlByKey = new Map<string, string>();
    if (keys.length > 0) {
      const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(keys, 60 * 60);
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) urlByKey.set(s.path, s.signedUrl);
      }
    }
    return vehicles.map((v) => {
      if (!v.photoDocumentId) return v;
      const key = keyByDocId.get(v.photoDocumentId);
      return { ...v, photoUrl: (key ? urlByKey.get(key) : null) ?? null };
    });
  } catch {
    return vehicles;
  }
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
            "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,photo_document_id,mileage,tag:tags!inner(id,name,color,is_active,notes,created_at)"
          )
          .eq("tag.kind", "vehicle")
          .range(lo, hi)
      );
    } catch {
      // Pre-migration: `mileage` may not exist yet (20260906113949_add_vehicle_mileage.sql
      // not run). Retry without it rather than showing an empty fleet — a missing
      // column must never look like missing data (see fetchAllPagedResult's note).
      try {
        data = await fetchAllPaged<Row>((lo, hi) =>
          supabase
            .from("vehicles")
            .select(
              "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,photo_document_id,tag:tags!inner(id,name,color,is_active,notes,created_at)"
            )
            .eq("tag.kind", "vehicle")
            .range(lo, hi)
        );
      } catch {
        // Pre-migration: `photo_document_id` may not exist yet either (db/sql/create_vehicle_photo.sql
        // not run). Retry without both.
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
      }
    }

    const vehicles = await resolveVehiclePhotoUrls(supabase, data.map(normalizeVehicle).filter((v) => v.tagId));

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

/**
 * The (at most 3) tasks a vehicle's expiry dates point at, resolved to
 * {id,subject,status} for display + a /tasks/[id] link. RLS-safe by
 * construction: a task the viewer can't see (e.g. someone else's private
 * task) simply won't come back from this select, so the link silently
 * doesn't render for them rather than leaking its subject.
 */
async function resolveVehicleSourceTasks(supabase: SupabaseClient, vehicle: Vehicle, row: Row): Promise<Vehicle> {
  const rawIds = {
    test: str(row.test_source_task_id),
    insurance: str(row.insurance_source_task_id),
    license: str(row.license_source_task_id),
  };
  const ids = Array.from(new Set(Object.values(rawIds).filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return vehicle;
  try {
    const { data } = await supabase.from("tasks").select("id,subject,status").in("id", ids);
    const byId = new Map<string, VehicleSourceTask>();
    for (const r of (data ?? []) as Row[]) {
      const id = str(r.id);
      if (id) byId.set(id, { id, subject: str(r.subject), status: str(r.status) });
    }
    return {
      ...vehicle,
      testSourceTask: rawIds.test ? byId.get(rawIds.test) ?? null : null,
      insuranceSourceTask: rawIds.insurance ? byId.get(rawIds.insurance) ?? null : null,
      licenseSourceTask: rawIds.license ? byId.get(rawIds.license) ?? null : null,
    };
  } catch {
    return vehicle;
  }
}

export async function fetchVehicle(
  supabase: SupabaseClient,
  tagId: string
): Promise<Vehicle | null> {
  try {
    let { data, error } = await supabase
      .from("vehicles")
      .select(
        "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,photo_document_id,mileage,mileage_updated_at,test_source_task_id,insurance_source_task_id,license_source_task_id,tag:tags!inner(id,name,color,is_active,notes,created_at)"
      )
      .eq("tag_id", tagId)
      .maybeSingle();
    if (error) {
      // Pre-migration: 20260907131007_add_vehicle_mileage_log.sql not run yet.
      ({ data, error } = await supabase
        .from("vehicles")
        .select(
          "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,photo_document_id,mileage,test_source_task_id,insurance_source_task_id,license_source_task_id,tag:tags!inner(id,name,color,is_active,notes,created_at)"
        )
        .eq("tag_id", tagId)
        .maybeSingle());
    }
    if (error) {
      // Pre-migration: 20260907125946_add_vehicle_expiry_source_task.sql not run yet.
      ({ data, error } = await supabase
        .from("vehicles")
        .select(
          "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,photo_document_id,mileage,tag:tags!inner(id,name,color,is_active,notes,created_at)"
        )
        .eq("tag_id", tagId)
        .maybeSingle());
    }
    if (error) {
      // Pre-migration fallback — see the matching comment in fetchVehicles.
      ({ data, error } = await supabase
        .from("vehicles")
        .select(
          "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,photo_document_id,tag:tags!inner(id,name,color,is_active,notes,created_at)"
        )
        .eq("tag_id", tagId)
        .maybeSingle());
    }
    if (error) {
      ({ data, error } = await supabase
        .from("vehicles")
        .select(
          "license_plate,make_model,year,test_due_date,insurance_due_date,license_due_date,owner_name,notes,tag:tags!inner(id,name,color,is_active,notes,created_at)"
        )
        .eq("tag_id", tagId)
        .maybeSingle());
    }
    if (error || !data) return null;
    const row = data as Row;
    const v = normalizeVehicle(row);
    if (!v.tagId) return null;
    const [resolved] = await resolveVehiclePhotoUrls(supabase, [v]);
    return resolveVehicleSourceTasks(supabase, resolved ?? v, row);
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
  url: string | null; // resolved signed URL, so the file can be opened from the car page
};

export type VehicleActivity = {
  expenses: VehicleExpense[];
  payments: VehiclePayment[];
  tasks: VehicleTask[];
  documents: VehicleDocument[];
  rollup: VehicleRollup;
};

/** A task counts as "open" unless it's done or cancelled — shared by the server rollup and the client card header. */
export function isVehicleTaskOpen(status: string | null) {
  return !["done", "cancelled"].includes(status ?? "todo");
}

/** Cash actually spent: the full amount once paid, otherwise just what's been paid so far. */
export function paidVehicleExpenseAmount(expenses: VehicleExpense[]): number {
  return expenses.reduce((sum, e) => sum + (e.paymentStatus === "paid" ? e.amount : e.paidAmount ?? 0), 0);
}

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
            .select("id,title,file_name,document_type,uploaded_at,storage_key")
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
      url: null,
    }));

    // Best-effort: resolve each document to a short-lived signed URL so it can
    // be opened from the car page. Wrapped separately so a storage hiccup
    // never wipes the expenses/tasks/payments already fetched above.
    try {
      const keyById = new Map<string, string>();
      for (const r of (dcRes.data ?? []) as Row[]) {
        const id = str(r.id);
        const key = str(r.storage_key);
        if (id && key) keyById.set(id, key);
      }
      const keys = Array.from(new Set(keyById.values()));
      if (keys.length > 0) {
        const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(keys, 60 * 60);
        const urlByKey = new Map<string, string>();
        for (const s of signed ?? []) {
          if (s.path && s.signedUrl) urlByKey.set(s.path, s.signedUrl);
        }
        for (const doc of documents) {
          const key = keyById.get(doc.id);
          if (key) doc.url = urlByKey.get(key) ?? null;
        }
      }
    } catch {
      // leave every url null — the list still renders, just without the open link
    }

    // Newest-first for the timeline-style lists.
    expenses.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    payments.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    documents.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));

    const rollup: VehicleRollup = {
      totalExpenseAmount: expenses.reduce((s, e) => s + e.amount, 0),
      paidExpenseAmount: paidVehicleExpenseAmount(expenses),
      totalIncomeAmount: payments.reduce((s, p) => s + p.amount, 0),
      taskCount: tasks.length,
      openTaskCount: tasks.filter((t) => isVehicleTaskOpen(t.status)).length,
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

/** "123456" → `123,456 ק"מ`, or null when unset (so callers can drop it from a joined subtitle line). */
export function formatMileage(mileage: number | null): string | null {
  if (mileage == null) return null;
  return `${new Intl.NumberFormat("he-IL").format(mileage)} ק"מ`;
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
