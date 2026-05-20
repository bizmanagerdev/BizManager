import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit";
import {
  createMorningClientFromCustomerRecord,
  createMorningDocument,
  getMorningClient,
  getMorningDocument,
  listMorningClients,
  updateMorningClientFromCustomerRecord,
  closeOrCancelMorningDocument,
  type MorningCustomerRow,
} from "@/lib/morning/client";
import { findMorningClientCandidatesForCustomerRecord } from "@/lib/morning/matching";
import { isOrderCompletionStatus, loadMorningSettings } from "@/lib/morning/settings";
import {
  MorningDocumentType,
  mapBizPaymentMethodToMorning,
  type MorningCreateDocumentPayload,
  type MorningDocumentLine,
  type MorningPaymentLine,
} from "@/lib/morning/types";

type DbRow = Record<string, unknown>;

const customerBillingSelect =
  "id,name,name_for_invoice,registration_number,phone,whatsapp,email,address,morning_client_id,morning_synced_at,morning_match_status,morning_last_sync_error";

export const morningDocumentInputSchema = z.object({
  customerId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  allowDuplicate: z.boolean().optional(),
  customLines: z
    .array(
      z.object({
        description: z.string().trim().min(1),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().nonnegative(),
        vatType: z.enum(["include", "exclude", "none"]).optional(),
        sku: z.string().trim().optional(),
      })
    )
    .optional(),
});

export const paymentDocumentInputSchema = z.object({
  paymentId: z.string().uuid(),
  allowDuplicate: z.boolean().optional(),
});

function getString(row: DbRow | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getNumber(row: DbRow | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function documentTypeLabel(type: MorningDocumentType) {
  switch (type) {
    case MorningDocumentType.Quote:
      return "הצעת מחיר";
    case MorningDocumentType.TaxInvoice:
      return "חשבונית מס";
    case MorningDocumentType.Receipt:
      return "קבלה";
    case MorningDocumentType.TaxInvoiceReceipt:
      return "חשבונית מס-קבלה";
    default:
      return `מסמך ${type}`;
  }
}

function toAuditSafeValue(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function loadCustomerRow(supabase: SupabaseClient, customerId: string) {
  const { data, error } = await supabase.from("customers").select(customerBillingSelect).eq("id", customerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("לקוח לא נמצא.");
  return data as DbRow;
}

function toMorningCustomerRow(row: DbRow): MorningCustomerRow {
  return {
    id: getString(row, ["id"]) ?? "",
    name: getString(row, ["name"]) ?? "לקוח",
    invoiceName: getString(row, ["name_for_invoice"]),
    email: getString(row, ["email"]),
    phone: getString(row, ["phone", "whatsapp"]),
    whatsapp: getString(row, ["whatsapp"]),
    registrationNumber: getString(row, ["registration_number"]),
    address: getString(row, ["address"]),
  };
}

async function updateCustomerMorningFields(
  supabase: SupabaseClient,
  customerId: string,
  patch: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", customerId)
    .select(customerBillingSelect)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as DbRow | null;
}

export async function ensureMorningClientForCustomer(
  supabase: SupabaseClient,
  customerId: string,
  actor: { profileId: string; role: string }
) {
  const customerRow = await loadCustomerRow(supabase, customerId);
  const customer = toMorningCustomerRow(customerRow);
  const existingMorningClientId = getString(customerRow, ["morning_client_id"]);

  try {
    const morningClient = existingMorningClientId
      ? await updateMorningClientFromCustomerRecord(existingMorningClientId, customer)
      : await createMorningClientFromCustomerRecord(customer);

    await updateCustomerMorningFields(supabase, customerId, {
      morning_client_id: morningClient.id,
      morning_synced_at: new Date().toISOString(),
      morning_match_status: "matched",
      morning_last_sync_error: null,
    });

  await logAuditEvent({
    supabase,
    tableName: "customers",
    recordId: customerId,
    action: existingMorningClientId ? "morning_customer_synced" : "morning_customer_linked",
    changedBy: actor.profileId,
    userRole: actor.role,
    newData: {
      morning_client_id: morningClient.id,
      morning_synced_at: new Date().toISOString(),
    },
  });

    return morningClient;
  } catch (error) {
    const message = error instanceof Error ? error.message : "סנכרון לקוח ל-Morning נכשל.";
    await updateCustomerMorningFields(supabase, customerId, {
      morning_last_sync_error: message,
    });
    throw error;
  }
}

export async function matchMorningCustomer(
  supabase: SupabaseClient,
  customerId: string
) {
  const customerRow = await loadCustomerRow(supabase, customerId);
  const remoteClients = await listMorningClients();
  const result = findMorningClientCandidatesForCustomerRecord(toMorningCustomerRow(customerRow), remoteClients);
  return {
    customer: customerRow,
    ...result,
  };
}

export async function importMatchMorningClients(supabase: SupabaseClient) {
  const [{ data: customers, error: customerError }, remoteClients] = await Promise.all([
    supabase
      .from("customers")
      .select(customerBillingSelect)
      .order("name", { ascending: true }),
    listMorningClients(),
  ]);

  if (customerError) throw new Error(customerError.message);

  const customerRows = ((customers ?? []) as DbRow[]).map((row) => {
    const match = findMorningClientCandidatesForCustomerRecord(toMorningCustomerRow(row), remoteClients);
    return {
      customer: row,
      ...match,
    };
  });

  return {
    customers: customerRows,
    morningClients: remoteClients,
  };
}

export async function linkMorningClientToCustomer(
  supabase: SupabaseClient,
  {
    customerId,
    morningClientId,
    actor,
  }: {
    customerId: string;
    morningClientId: string;
    actor: { profileId: string; role: string };
  }
) {
  const remoteClient = await getMorningClient(morningClientId);
  const updated = await updateCustomerMorningFields(supabase, customerId, {
    morning_client_id: remoteClient.id,
    morning_synced_at: new Date().toISOString(),
    morning_match_status: "matched",
    morning_last_sync_error: null,
  });

  await logAuditEvent({
    supabase,
    tableName: "customers",
    recordId: customerId,
    action: "morning_customer_linked",
    changedBy: actor.profileId,
    userRole: actor.role,
    newData: {
      morning_client_id: remoteClient.id,
      morning_synced_at: new Date().toISOString(),
    },
  });

  return { customer: updated, morningClient: remoteClient };
}

export async function createLocalCustomerFromMorningClient(
  supabase: SupabaseClient,
  {
    morningClientId,
    actor,
  }: {
    morningClientId: string;
    actor: { profileId: string; role: string };
  }
) {
  const remote = await getMorningClient(morningClientId);
  const insert = {
    name: remote.companyName?.trim() || remote.name.trim(),
    name_for_invoice: remote.name.trim(),
    registration_number: remote.taxId ?? remote.registrationNumber ?? null,
    phone: remote.mobile ?? remote.phone ?? null,
    whatsapp: remote.mobile ?? remote.phone ?? null,
    email: remote.email ?? null,
    address: [remote.city, remote.address].filter(Boolean).join(" | ") || null,
    active: true,
    notes: "נוצר מ-Morning",
    morning_client_id: remote.id,
    morning_synced_at: new Date().toISOString(),
    morning_match_status: "matched",
    morning_last_sync_error: null,
  };

  const { data, error } = await supabase
    .from("customers")
    .insert(insert)
    .select(customerBillingSelect)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("יצירת לקוח מקומי מ-Morning נכשלה.");

  await logAuditEvent({
    supabase,
    tableName: "customers",
    recordId: getString(data as DbRow, ["id"]) ?? "",
    action: "create",
    changedBy: actor.profileId,
    userRole: actor.role,
    newData: {
      name: insert.name,
      name_for_invoice: insert.name_for_invoice,
      registration_number: insert.registration_number,
      phone: insert.phone,
      whatsapp: insert.whatsapp,
      email: insert.email,
      address: insert.address,
      morning_client_id: insert.morning_client_id,
      morning_match_status: insert.morning_match_status,
    },
  });

  return data as DbRow;
}

async function buildOrderLines(supabase: SupabaseClient, orderId: string) {
  const [{ data: orderItems, error: itemsError }, { data: orderSummary, error: orderError }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id,product_id,quantity_ordered,unit_price,line_total")
      .eq("order_id", orderId),
    supabase
      .from("order_overview_view")
      .select("order_id,total_amount")
      .eq("order_id", orderId)
      .maybeSingle(),
  ]);

  if (itemsError) throw new Error(itemsError.message);
  if (orderError) throw new Error(orderError.message);

  const productIds = Array.from(
    new Set(
      ((orderItems ?? []) as DbRow[])
        .map((item) => getString(item, ["product_id"]))
        .filter((value): value is string => Boolean(value))
    )
  );
  const { data: products, error: productsError } = productIds.length
    ? await supabase.from("products").select("id,name").in("id", productIds)
    : { data: [], error: null };
  if (productsError) throw new Error(productsError.message);

  const productById = new Map<string, string>();
  ((products ?? []) as DbRow[]).forEach((row) => {
    const id = getString(row, ["id"]);
    const name = getString(row, ["name"]);
    if (id && name) productById.set(id, name);
  });

  const lines = ((orderItems ?? []) as DbRow[]).map((item, index) => {
    const productId = getString(item, ["product_id"]);
    return {
      description: (productId ? productById.get(productId) : null) ?? `שורת הזמנה ${index + 1}`,
      quantity: Math.max(1, getNumber(item, ["quantity_ordered"]) ?? 1),
      unitPrice:
        getNumber(item, ["unit_price"]) ??
        getNumber(item, ["line_total"]) ??
        0,
      vatType: "include" as const,
      sku: productId,
    };
  });

  if (lines.length > 0) return lines;

  return [
    {
      description: `הזמנה ${orderId.slice(0, 8)}`,
      quantity: 1,
      unitPrice: Math.max(0, getNumber(orderSummary as DbRow | null, ["total_amount"]) ?? 0),
      vatType: "include" as const,
    },
  ];
}

async function buildProjectLines(supabase: SupabaseClient, projectId: string) {
  const [{ data: project, error: projectError }, { data: financials, error: financialsError }] = await Promise.all([
    supabase.from("projects").select("id,name").eq("id", projectId).maybeSingle(),
    supabase
      .from("project_financials_view")
      .select("id,customer_total_price")
      .eq("id", projectId)
      .maybeSingle(),
  ]);

  if (projectError) throw new Error(projectError.message);
  if (financialsError) throw new Error(financialsError.message);
  if (!project) throw new Error("הפרויקט לא נמצא.");

  return [
    {
      description: getString(project as DbRow, ["name"]) ?? "פרויקט",
      quantity: 1,
      unitPrice: Math.max(0, getNumber(financials as DbRow | null, ["customer_total_price"]) ?? 0),
      vatType: "include" as const,
    },
  ];
}

async function loadPaymentForDocument(supabase: SupabaseClient, paymentId: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("id,amount_total,payment_date,payment_method,reference_number,notes,order_id,project_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("התשלום לא נמצא.");
  return data as DbRow;
}

async function resolveCustomerIdForPayment(supabase: SupabaseClient, payment: DbRow) {
  const directCustomerId = getString(payment, ["customer_id"]);
  if (directCustomerId) return directCustomerId;

  const orderId = getString(payment, ["order_id"]);
  if (orderId) {
    const { data, error } = await supabase.from("orders").select("customer_id").eq("id", orderId).maybeSingle();
    if (error) throw new Error(error.message);
    const customerId = getString(data as DbRow | null, ["customer_id"]);
    if (customerId) return customerId;
  }

  const projectId = getString(payment, ["project_id"]);
  if (projectId) {
    const { data, error } = await supabase.from("projects").select("customer_id").eq("id", projectId).maybeSingle();
    if (error) throw new Error(error.message);
    const customerId = getString(data as DbRow | null, ["customer_id"]);
    if (customerId) return customerId;
  }

  throw new Error("לא נמצא לקוח מקושר לתשלום.");
}

async function findDuplicateDocument(
  supabase: SupabaseClient,
  {
    type,
    paymentId,
    orderId,
    projectId,
  }: {
    type: MorningDocumentType;
    paymentId?: string;
    orderId?: string;
    projectId?: string;
  }
) {
  if (type === MorningDocumentType.Quote) return null;

  let query = supabase.from("morning_documents").select("id,document_type,morning_document_number").limit(1);

  if (paymentId && (type === MorningDocumentType.Receipt || type === MorningDocumentType.TaxInvoiceReceipt)) {
    query = query.eq("payment_id", paymentId).in("document_type", [MorningDocumentType.Receipt, MorningDocumentType.TaxInvoiceReceipt]);
  } else if (orderId || projectId) {
    if (orderId) query = query.eq("order_id", orderId);
    if (projectId) query = query.eq("project_id", projectId);
    query = query.in("document_type", [MorningDocumentType.TaxInvoice, MorningDocumentType.TaxInvoiceReceipt]);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as DbRow | null;
}

async function createExternalDocumentLink(
  supabase: SupabaseClient,
  {
    title,
    documentType,
    externalUrl,
    userAuthId,
    customerId,
    orderId,
    projectId,
    paymentId,
  }: {
    title: string;
    documentType: string;
    externalUrl: string | null;
    userAuthId: string;
    customerId: string;
    orderId?: string;
    projectId?: string;
    paymentId?: string;
  }
) {
  if (!externalUrl) return null;

  const documentId = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();
  const { error: docError } = await supabase.from("documents").insert({
    id: documentId,
    document_type: documentType,
    title,
    file_name: `${title}.pdf`,
    storage_key: null,
    uploaded_by: userAuthId,
    uploaded_at: uploadedAt,
    notes: externalUrl,
  });
  if (docError) throw new Error(docError.message);

  const links = [
    { document_id: documentId, entity_type: "customer", entity_id: customerId },
  ];
  if (orderId) links.push({ document_id: documentId, entity_type: "order", entity_id: orderId });
  if (projectId) links.push({ document_id: documentId, entity_type: "project", entity_id: projectId });
  if (paymentId) links.push({ document_id: documentId, entity_type: "payment", entity_id: paymentId });

  const { error: linkError } = await supabase.from("document_links").insert(links);
  if (linkError) throw new Error(linkError.message);

  return documentId;
}

async function persistMorningDocument(
  supabase: SupabaseClient,
  {
    result,
    type,
    customerId,
    orderId,
    projectId,
    paymentId,
    morningClientId,
    sourcePayload,
    responsePayload,
    actor,
  }: {
    result: Awaited<ReturnType<typeof createMorningDocument>>;
    type: MorningDocumentType;
    customerId: string;
    orderId?: string;
    projectId?: string;
    paymentId?: string;
    morningClientId: string;
    sourcePayload: Record<string, unknown>;
    responsePayload: Record<string, unknown>;
    actor: { profileId: string; authUserId: string; role: string };
  }
) {
  const label = documentTypeLabel(type);
  const title = result.number ? `${label} ${result.number}` : label;
  const documentId = await createExternalDocumentLink(supabase, {
    title,
    documentType: `morning_${type}`,
    externalUrl: result.pdfUrl ?? result.morningUrl,
    userAuthId: actor.authUserId,
    customerId,
    orderId,
    projectId,
    paymentId,
  });

  const payload = {
    morning_document_id: result.id,
    morning_document_number: result.number,
    document_type: type,
    document_type_label: label,
    status: result.status || "created",
    customer_id: customerId,
    order_id: orderId ?? null,
    project_id: projectId ?? null,
    payment_id: paymentId ?? null,
    document_id: documentId,
    morning_client_id: morningClientId,
    amount: result.amount,
    currency: result.currency || "ILS",
    morning_url: result.morningUrl,
    pdf_url: result.pdfUrl,
    source_payload: sourcePayload,
    response_payload: responsePayload,
    issued_by: actor.profileId,
    issued_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("morning_documents").insert(payload).select("*").maybeSingle();
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    tableName: "morning_documents",
    recordId: getString(data as DbRow | null, ["id"]) ?? "",
    action: "morning_document_created",
    changedBy: actor.profileId,
    userRole: actor.role,
    newData: {
      morning_document_id: payload.morning_document_id,
      morning_document_number: payload.morning_document_number,
      document_type: payload.document_type,
      document_type_label: payload.document_type_label,
      status: payload.status,
      customer_id: payload.customer_id,
      order_id: payload.order_id,
      project_id: payload.project_id,
      payment_id: payload.payment_id,
      document_id: payload.document_id,
      morning_client_id: payload.morning_client_id,
      amount: payload.amount,
      currency: payload.currency,
      morning_url: payload.morning_url,
      pdf_url: payload.pdf_url,
      source_payload: toAuditSafeValue(payload.source_payload),
      response_payload: toAuditSafeValue(payload.response_payload),
    },
  });

  return data;
}

async function buildLinesForSource(
  supabase: SupabaseClient,
  {
    orderId,
    projectId,
    customLines,
  }: {
    orderId?: string;
    projectId?: string;
    customLines?: MorningDocumentLine[];
  }
) {
  if (customLines && customLines.length > 0) return customLines;
  if (orderId) return buildOrderLines(supabase, orderId);
  if (projectId) return buildProjectLines(supabase, projectId);
  throw new Error("יש לבחור מקור למסמך או להזין שורות ידניות.");
}

export async function issueMorningDocumentForSource(
  supabase: SupabaseClient,
  {
    type,
    customerId,
    orderId,
    projectId,
    paymentId,
    notes,
    customLines,
    paymentLines,
    allowDuplicate,
    actor,
  }: {
    type: MorningDocumentType;
    customerId: string;
    orderId?: string;
    projectId?: string;
    paymentId?: string;
    notes?: string;
    customLines?: MorningDocumentLine[];
    paymentLines?: MorningPaymentLine[];
    allowDuplicate?: boolean;
    actor: { profileId: string; authUserId: string; role: string };
  }
) {
  const existingDuplicate = await findDuplicateDocument(supabase, { type, paymentId, orderId, projectId });
  if (existingDuplicate && !allowDuplicate) {
    throw new Error("כבר קיים מסמך Morning דומה לרשומה הזו. רק מנהל יכול לאשר כפילות.");
  }

  const customerRow = await loadCustomerRow(supabase, customerId);
  const morningClient = await ensureMorningClientForCustomer(supabase, customerId, {
    profileId: actor.profileId,
    role: actor.role,
  });
  const lines = await buildLinesForSource(supabase, { orderId, projectId, customLines });

  const payload: MorningCreateDocumentPayload = {
    clientId: morningClient.id,
    type,
    remarks: notes ?? undefined,
    description: getString(customerRow, ["name_for_invoice", "name"]) ?? undefined,
    externalId: [orderId, projectId, paymentId].filter(Boolean).join(":") || null,
    lines,
    ...(paymentLines?.length ? { payments: paymentLines } : {}),
  };

  const result = await createMorningDocument(payload);
  const saved = await persistMorningDocument(supabase, {
    result,
    type,
    customerId,
    orderId,
    projectId,
    paymentId,
    morningClientId: morningClient.id,
    sourcePayload: payload as unknown as Record<string, unknown>,
    responsePayload: result.raw,
    actor,
  });

  return {
    customer: customerRow,
    morningClient,
    morningDocument: saved,
    remoteDocument: result,
  };
}

export async function issueMorningReceiptForPayment(
  supabase: SupabaseClient,
  {
    paymentId,
    type,
    allowDuplicate,
    actor,
  }: {
    paymentId: string;
    type: MorningDocumentType.Receipt | MorningDocumentType.TaxInvoiceReceipt;
    allowDuplicate?: boolean;
    actor: { profileId: string; authUserId: string; role: string };
  }
) {
  const payment = await loadPaymentForDocument(supabase, paymentId);
  const customerId = await resolveCustomerIdForPayment(supabase, payment);
  const amount = Math.max(0, getNumber(payment, ["amount_total"]) ?? 0);
  const orderId = getString(payment, ["order_id"]) ?? undefined;
  const projectId = getString(payment, ["project_id"]) ?? undefined;
  const paymentDate =
    getString(payment, ["payment_date"]) ?? new Date().toISOString().slice(0, 10);
  const paymentMethodCode = mapBizPaymentMethodToMorning(getString(payment, ["payment_method"]));
  const referenceNumber = getString(payment, ["reference_number"]);

  return issueMorningDocumentForSource(supabase, {
    type,
    customerId,
    orderId,
    projectId,
    paymentId,
    allowDuplicate,
    actor,
    customLines: [
      {
        description:
          type === MorningDocumentType.TaxInvoiceReceipt
            ? "חשבונית מס-קבלה על תשלום"
            : "קבלה על תשלום",
        quantity: 1,
        unitPrice: amount,
        vatType: "include",
      },
    ],
    paymentLines: [
      {
        type: paymentMethodCode,
        date: paymentDate.slice(0, 10),
        price: amount,
        currency: "ILS",
        ...(paymentMethodCode === 2 && referenceNumber ? { chequeNumber: referenceNumber } : {}),
      },
    ],
    notes: getString(payment, ["notes"]) ?? undefined,
  });
}

export async function syncMorningDocumentByLocalId(
  supabase: SupabaseClient,
  {
    localDocumentId,
    actor,
  }: {
    localDocumentId: string;
    actor: { profileId: string; role: string };
  }
) {
  const { data, error } = await supabase
    .from("morning_documents")
    .select("*")
    .eq("id", localDocumentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("מסמך Morning לא נמצא.");

  const remote = await getMorningDocument(getString(data as DbRow, ["morning_document_id"]) ?? "");
  const patch = {
    status: remote.status,
    morning_document_number: remote.number,
    amount: remote.amount,
    currency: remote.currency,
    morning_url: remote.morningUrl,
    pdf_url: remote.pdfUrl,
    response_payload: remote.raw,
    closed_at: remote.status === "cancelled" || remote.status === "closed" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error: updateError } = await supabase
    .from("morning_documents")
    .update(patch)
    .eq("id", localDocumentId)
    .select("*")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);

  await logAuditEvent({
    supabase,
    tableName: "morning_documents",
    recordId: localDocumentId,
    action: "morning_document_synced",
    changedBy: actor.profileId,
    userRole: actor.role,
    newData: {
      status: patch.status,
      morning_document_number: patch.morning_document_number,
      amount: patch.amount,
      currency: patch.currency,
      morning_url: patch.morning_url,
      pdf_url: patch.pdf_url,
      response_payload: toAuditSafeValue(patch.response_payload),
      closed_at: patch.closed_at,
      updated_at: patch.updated_at,
    },
  });

  return updated;
}

type AutoIssueOutcome =
  | { ok: true; skipped: false; reason: null; morningDocumentId: string | null }
  | { ok: true; skipped: true; reason: string; morningDocumentId: null }
  | { ok: false; skipped: false; reason: string; morningDocumentId: null };

async function logAutoIssueFailure(
  supabase: SupabaseClient,
  {
    tableName,
    recordId,
    action,
    actor,
    error,
  }: {
    tableName: string;
    recordId: string;
    action: string;
    actor: { profileId: string; role: string };
    error: string;
  }
) {
  try {
    await logAuditEvent({
      supabase,
      tableName,
      recordId,
      action,
      changedBy: actor.profileId,
      userRole: actor.role,
      newData: { error },
    });
  } catch {
    // never let audit logging break the parent operation
  }
}

export async function tryAutoIssueInvoiceForOrder(
  supabase: SupabaseClient,
  {
    orderId,
    newStatus,
    trigger,
    actor,
  }: {
    orderId: string;
    newStatus: string | null | undefined;
    // "create" → fires regardless of status (new orders should issue immediately if enabled).
    // "status-change" → fires only when status transitions into a completion state.
    trigger: "create" | "status-change";
    actor: { profileId: string; authUserId: string; role: string };
  }
): Promise<AutoIssueOutcome> {
  try {
    if (trigger === "status-change" && !isOrderCompletionStatus(newStatus ?? null)) {
      return { ok: true, skipped: true, reason: "status_not_completion", morningDocumentId: null };
    }

    const settings = await loadMorningSettings(supabase);
    if (!settings.autoInvoiceOnOrderCompletion) {
      return { ok: true, skipped: true, reason: "auto_disabled", morningDocumentId: null };
    }

    const { data: existing, error: existingError } = await supabase
      .from("morning_documents")
      .select("id")
      .eq("order_id", orderId)
      .in("document_type", [MorningDocumentType.TaxInvoice, MorningDocumentType.TaxInvoiceReceipt])
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      return { ok: true, skipped: true, reason: "already_issued", morningDocumentId: null };
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,customer_id,status")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    const customerId = getString(order as DbRow | null, ["customer_id"]);
    if (!order || !customerId) {
      return { ok: true, skipped: true, reason: "no_customer", morningDocumentId: null };
    }

    const result = await issueMorningDocumentForSource(supabase, {
      type: settings.invoiceTypeOnCompletion,
      customerId,
      orderId,
      actor,
    });

    const morningDocumentId = getString(result.morningDocument as DbRow | null, ["id"]);
    return { ok: true, skipped: false, reason: null, morningDocumentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "auto-issue invoice failed";
    await logAutoIssueFailure(supabase, {
      tableName: "orders",
      recordId: orderId,
      action: "morning_auto_invoice_failed",
      actor,
      error: message,
    });
    return { ok: false, skipped: false, reason: message, morningDocumentId: null };
  }
}

export async function tryAutoIssueReceiptForPayment(
  supabase: SupabaseClient,
  {
    paymentId,
    actor,
  }: {
    paymentId: string;
    actor: { profileId: string; authUserId: string; role: string };
  }
): Promise<AutoIssueOutcome> {
  try {
    const settings = await loadMorningSettings(supabase);
    if (!settings.autoReceiptOnPayment) {
      return { ok: true, skipped: true, reason: "auto_disabled", morningDocumentId: null };
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id,amount_total,order_id,project_id,property_id")
      .eq("id", paymentId)
      .maybeSingle();
    if (paymentError) throw new Error(paymentError.message);
    if (!payment) {
      return { ok: true, skipped: true, reason: "payment_not_found", morningDocumentId: null };
    }

    const amount = getNumber(payment as DbRow, ["amount_total"]) ?? 0;
    if (amount <= 0) {
      return { ok: true, skipped: true, reason: "non_positive_amount", morningDocumentId: null };
    }

    const orderId = getString(payment as DbRow, ["order_id"]);
    const projectId = getString(payment as DbRow, ["project_id"]);
    if (!orderId && !projectId) {
      // Property-only payments don't have a customer in BizH today.
      return { ok: true, skipped: true, reason: "no_linked_customer", morningDocumentId: null };
    }

    const { data: existing, error: existingError } = await supabase
      .from("morning_documents")
      .select("id")
      .eq("payment_id", paymentId)
      .in("document_type", [MorningDocumentType.Receipt, MorningDocumentType.TaxInvoiceReceipt])
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      return { ok: true, skipped: true, reason: "already_issued", morningDocumentId: null };
    }

    const result = await issueMorningReceiptForPayment(supabase, {
      paymentId,
      type: settings.receiptTypeOnPayment,
      actor,
    });

    const morningDocumentId = getString(result.morningDocument as DbRow | null, ["id"]);
    return { ok: true, skipped: false, reason: null, morningDocumentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "auto-issue receipt failed";
    await logAutoIssueFailure(supabase, {
      tableName: "payments",
      recordId: paymentId,
      action: "morning_auto_receipt_failed",
      actor,
      error: message,
    });
    return { ok: false, skipped: false, reason: message, morningDocumentId: null };
  }
}

export async function closeMorningDocumentByLocalId(
  supabase: SupabaseClient,
  {
    localDocumentId,
    actor,
  }: {
    localDocumentId: string;
    actor: { profileId: string; role: string };
  }
) {
  const { data, error } = await supabase
    .from("morning_documents")
    .select("*")
    .eq("id", localDocumentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("מסמך Morning לא נמצא.");

  const remote = await closeOrCancelMorningDocument(getString(data as DbRow, ["morning_document_id"]) ?? "");
  const patch = {
    status: remote.status || "closed",
    morning_url: remote.morningUrl,
    pdf_url: remote.pdfUrl,
    response_payload: remote.raw,
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error: updateError } = await supabase
    .from("morning_documents")
    .update(patch)
    .eq("id", localDocumentId)
    .select("*")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);

  await logAuditEvent({
    supabase,
    tableName: "morning_documents",
    recordId: localDocumentId,
    action: "morning_document_closed",
    changedBy: actor.profileId,
    userRole: actor.role,
    newData: {
      status: patch.status,
      morning_url: patch.morning_url,
      pdf_url: patch.pdf_url,
      response_payload: toAuditSafeValue(patch.response_payload),
      closed_at: patch.closed_at,
      updated_at: patch.updated_at,
    },
  });

  return updated;
}
