import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { isExpenseBusinessDomain } from "@/lib/expenses";

import { STORAGE_BUCKET } from "@/lib/storage";

const BUCKET = STORAGE_BUCKET;
const MAX_BYTES = 20 * 1024 * 1024;

function safeExtensionFromFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return "";
  const ext = (parts.pop() ?? "").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    // A queued offline upload carries an Idempotency-Key so a flaky-reconnect
    // replay can't create a second document + storage object.
    return withIdempotency(req, supabase, user.id, "financial-attachments/upload", async () => {
    const form = await req.formData();
    const entityTypeValue = String(form.get("entity_type") ?? "").trim();
    const entityId = String(form.get("entity_id") ?? "").trim();
    const file = form.get("file");

    const entityType =
      entityTypeValue === "expense" || entityTypeValue === "payment" || entityTypeValue === "session"
        ? entityTypeValue
        : null;

    if (!entityType) {
      return NextResponse.json({ error: "Missing or invalid entity_type" }, { status: 400 });
    }
    if (!entityId) {
      return NextResponse.json({ error: "Missing entity_id" }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 413 });
    }

    const table =
      entityType === "expense"
        ? "expenses"
        : entityType === "payment"
          ? "payments"
          : "attendance_sessions";
    // attendance_sessions have no order_id but carry the worker (user_id);
    // payments & expenses carry order_id.
    const selectColumns =
      entityType === "payment"
        ? "id,project_id,property_id,order_id,business_domain,payment_method"
        : entityType === "expense"
          ? "id,project_id,property_id,order_id,business_domain"
          : "id,project_id,property_id,business_domain,user_id";
    const { data: entity, error: entityError } = await supabase
      .from(table)
      .select(selectColumns)
      .eq("id", entityId)
      .maybeSingle();

    if (entityError) return NextResponse.json({ error: toHebrewError(entityError.message) }, { status: 400 });
    const entityRow = entity as {
      id?: string;
      project_id?: string | null;
      property_id?: string | null;
      order_id?: string | null;
      user_id?: string | null;
      business_domain?: string | null;
      payment_method?: string | null;
    } | null;
    if (!entityRow?.id) return NextResponse.json({ error: `${entityType} not found` }, { status: 404 });

    const projectId =
      typeof entityRow.project_id === "string" && entityRow.project_id ? entityRow.project_id : null;
    const orderId = typeof entityRow.order_id === "string" && entityRow.order_id ? entityRow.order_id : null;
    const sessionUserId =
      entityType === "session" && typeof entityRow.user_id === "string" && entityRow.user_id
        ? entityRow.user_id
        : null;

    // Derive the customer from the order (preferred) or project so the file is
    // also related to the לקוח, not only the payment/expense/session.
    let customerId: string | null = null;
    if (orderId) {
      const { data: order } = await supabase.from("orders").select("customer_id").eq("id", orderId).maybeSingle();
      customerId = typeof order?.customer_id === "string" ? order.customer_id : null;
    } else if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("customer_id")
        .eq("id", projectId)
        .maybeSingle();
      customerId = typeof project?.customer_id === "string" ? project.customer_id : null;
    }

    // A check payment's photo is filed as a "צק" category; otherwise the generic
    // <entity>_attachment.
    const isCheckPayment =
      entityType === "payment" && String(entityRow.payment_method ?? "").trim() === "check";
    const documentType = isCheckPayment ? "צק" : `${entityType}_attachment`;

    // Domain: the payment/expense/session each carry their own authoritative
    // business_domain — store it explicitly so the file lands in that תחום
    // (sessions can be domain-only with no order/project). When the parent has
    // no domain of its own, fall back to what it is ATTACHED to (a property's
    // expense is ניהול נכסים, a project's is פרויקטים) before שוטף — and never
    // to NULL, since documents.business_domain is NOT NULL and would reject the
    // insert with a 23502 instead of filing the attachment somewhere sensible.
    const docBusinessDomain = isExpenseBusinessDomain(entityRow.business_domain)
      ? entityRow.business_domain
      : entityRow.property_id
        ? "property_management"
        : entityRow.project_id
          ? "logistics_projects"
          : "general_business";

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "attachment").trim() || "attachment";
    const ext = safeExtensionFromFilename(displayName);
    const storagePath = ext
      ? `financial/${entityType}s/${entityId}/${documentId}.${ext}`
      : `financial/${entityType}s/${entityId}/${documentId}`;
    const uploadedAt = new Date().toISOString();

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) return NextResponse.json({ error: toHebrewError(uploadError.message) }, { status: 400 });

    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: documentType,
      business_domain: docBusinessDomain,
      title: displayName,
      file_name: displayName,
      storage_key: storagePath,
      uploaded_by: user.id,
      uploaded_at: uploadedAt,
      notes: null,
    });

    if (docError) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: toHebrewError(docError.message) }, { status: 400 });
    }

    // Relate the file to everything it has to do with: the source entity (kept —
    // the checks register looks photos up by the payment link), its order and/or
    // project, and the derived customer.
    const linkRows = [
      {
        document_id: documentId,
        entity_type: entityType,
        entity_id: entityId,
      },
    ];

    if (projectId) {
      linkRows.push({ document_id: documentId, entity_type: "project", entity_id: projectId });
    }
    if (orderId) {
      linkRows.push({ document_id: documentId, entity_type: "order", entity_id: orderId });
    }
    if (customerId) {
      linkRows.push({ document_id: documentId, entity_type: "customer", entity_id: customerId });
    }
    if (sessionUserId) {
      linkRows.push({ document_id: documentId, entity_type: "user", entity_id: sessionUserId });
    }

    const { error: linkError } = await supabase.from("document_links").insert(linkRows);

    if (linkError) {
      await supabase.from("documents").delete().eq("id", documentId);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
    }

    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);

    return NextResponse.json({
      attachment: {
        document_id: documentId,
        file_name: displayName,
        storage_key: storagePath,
        document_type: documentType,
        uploaded_at: uploadedAt,
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
      },
    });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
