import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { isExpenseBusinessDomain, type ExpenseBusinessDomain } from "@/lib/expenses";
import { DEFAULT_DOCUMENT_CATEGORY } from "@/lib/documents";
import { parseTagIds, syncEntityTags } from "@/lib/tags";

import { STORAGE_BUCKET } from "@/lib/storage";

const BUCKET = STORAGE_BUCKET;
const MAX_BYTES = 200 * 1024 * 1024;

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
    const { supabase, user, profile } = access.value;

    // A queued offline upload carries an Idempotency-Key so a flaky-reconnect
    // replay can't create a second document + storage object.
    return withIdempotency(req, supabase, user.id, "documents/upload", async () => {
    const form = await req.formData();
    const file = form.get("file");
    const businessDomainRaw = String(form.get("business_domain") ?? "").trim();
    const businessDomain = isExpenseBusinessDomain(businessDomainRaw)
      ? businessDomainRaw
      : "general_business";
    const projectId = String(form.get("project_id") ?? "").trim();
    const propertyId = String(form.get("property_id") ?? "").trim();
    const customerId = String(form.get("customer_id") ?? "").trim();
    const category = String(form.get("category") ?? form.get("tag") ?? "").trim();
    // Optional vehicle/tag links sent as a JSON array string, plus the year the
    // file is FOR (e.g. a 2026 טסט) so it's searchable by year.
    let tagIds: string[] = [];
    try {
      tagIds = parseTagIds(JSON.parse(String(form.get("tag_ids") ?? "[]")));
    } catch {
      tagIds = [];
    }
    const refYearRaw = Number(form.get("ref_year"));
    const refYear = Number.isInteger(refYearRaw) && refYearRaw > 0 ? refYearRaw : null;

    // Resolve the link target. A customer_id (customer-page upload) links to that
    // customer; logistics_projects links to a project; property_management links
    // to a property; every other domain uploads as a standalone document with no
    // entity link (still tagged with its business_domain).
    let linkedEntityType: "customer" | "project" | "property" | null = null;
    let linkedEntityId: string | null = null;
    let storageFolder = "general";

    if (customerId) {
      linkedEntityType = "customer";
      linkedEntityId = customerId;
      storageFolder = "customers";
    } else if (businessDomain === "logistics_projects") {
      if (!projectId) {
        return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
      }
      linkedEntityType = "project";
      linkedEntityId = projectId;
      storageFolder = "projects";
    } else if (businessDomain === "property_management") {
      if (!propertyId) {
        return NextResponse.json({ error: "Missing property_id" }, { status: 400 });
      }
      linkedEntityType = "property";
      linkedEntityId = propertyId;
      storageFolder = "properties";
    }

    // The domain stored on the row. This used to be NULL for anything with an
    // entity link, so the archive could infer the domain from that link — but
    // documents.business_domain is NOT NULL in the database (the manual
    // db/sql/add_documents_business_domain.sql script meant to relax it never
    // ran), so every linked upload died on a 23502 not-null violation.
    //
    // The link decides, not the caller: a file hanging off a property IS
    // ניהול נכסים and a file hanging off a project IS פרויקטים, so neither can
    // land in שוטף because some caller forgot to send the field. Only an
    // unlinked (or customer) file falls back to what was sent.
    const storedBusinessDomain: ExpenseBusinessDomain =
      linkedEntityType === "property"
        ? "property_management"
        : linkedEntityType === "project"
          ? "logistics_projects"
          : businessDomain;

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 413 });
    }

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "file").trim() || "file";
    const ext = safeExtensionFromFilename(displayName);
    const storageBase = linkedEntityId
      ? `${storageFolder}/${linkedEntityId}/${documentId}`
      : `${storageFolder}/${documentId}`;
    const storagePath = ext ? `${storageBase}.${ext}` : storageBase;
    const uploadedAt = new Date().toISOString();

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) {
      // Raw error first: toHebrewError collapses anything it doesn't recognise
      // (storage RLS denials among them) into a generic line, which is what
      // makes a failing upload impossible to tell apart from a validation slip.
      console.error("[documents/upload] storage upload failed", { storagePath, uploadError });
      return NextResponse.json({ error: toHebrewError(uploadError.message) }, { status: 400 });
    }

    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: category || DEFAULT_DOCUMENT_CATEGORY,
      business_domain: storedBusinessDomain,
      title: displayName,
      file_name: displayName,
      storage_key: storagePath,
      uploaded_by: user.id,
      uploaded_at: uploadedAt,
      notes: null,
    });

    if (docError) {
      console.error("[documents/upload] documents insert failed", { documentId, docError });
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: toHebrewError(docError.message) }, { status: 400 });
    }

    // Standalone documents (home/charity/general_business/sales/spaceit with no
    // customer) carry no entity link — only project/property/customer do.
    if (linkedEntityType && linkedEntityId) {
      const { error: linkError } = await supabase.from("document_links").insert({
        document_id: documentId,
        entity_type: linkedEntityType,
        entity_id: linkedEntityId,
      });

      if (linkError) {
        console.error("[documents/upload] document_links insert failed", {
          documentId,
          linkedEntityType,
          linkedEntityId,
          linkError,
        });
        await supabase.from("documents").delete().eq("id", documentId);
        await supabase.storage.from(BUCKET).remove([storagePath]);
        return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
      }
    }

    await syncEntityTags(supabase, "document", documentId, tagIds, {
      createdBy: profile.id,
      refYear,
    });

    await logAuditEvent({
      supabase,
      tableName: "documents",
      recordId: documentId,
      action: "upload",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({
      document: {
        id: documentId,
        storage_key: storagePath,
        file_name: displayName,
        document_type: category || DEFAULT_DOCUMENT_CATEGORY,
        uploaded_at: uploadedAt,
        business_domain: businessDomain,
        project_id: linkedEntityType === "project" ? linkedEntityId : null,
        property_id: linkedEntityType === "property" ? linkedEntityId : null,
      },
    });
    });
  } catch (err: unknown) {
    // Log the raw error before the Hebrew mapping collapses anything it doesn't
    // recognise into a generic line — that mapping is what left this route's
    // 500s undebuggable from the Vercel/Sentry side.
    console.error("[documents/upload] failed", err);
    const raw = err instanceof Error ? err.message : String(err ?? "");
    return NextResponse.json(
      { error: toHebrewError(err, raw ? `שגיאה בהעלאת הקובץ: ${raw}` : "Unknown error") },
      { status: 500 }
    );
  }
}
