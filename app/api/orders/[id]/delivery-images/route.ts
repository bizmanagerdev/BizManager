import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { hasDeliveriesAccess } from "@/lib/auth/roleAccess";
import { toHebrewError } from "@/lib/error-messages";
import { withIdempotency } from "@/lib/idempotency";
import { STORAGE_BUCKET } from "@/lib/storage";

const BUCKET = STORAGE_BUCKET;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function safeExtensionFromFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return "";
  const ext = (parts.pop() ?? "").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 10);
}

/**
 * Adds ONE delivery-proof photo to an order, independent of the אישור אספקה
 * confirm flow (`orders/update`'s multipart branch) — this lets the order
 * details page manage photos (add/replace/remove) any time, not just while
 * confirming a delivery. Same storage path + documents/document_links shape
 * as that flow, so both surfaces show the exact same photos.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, user, profile } = access.value;
  if (!hasDeliveriesAccess(profile.role, profile.deliveries_access)) {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }

  const { id: orderId } = await context.params;
  if (!orderId) return NextResponse.json({ error: "Missing order id" }, { status: 400 });

  return withIdempotency(req, supabase, user.id, "orders/delivery-images", async () => {
    const { data: order } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: "לא נבחרה תמונה." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "הקובץ המצורף חייב להיות תמונה." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "התמונה גדולה מדי (עד 20MB)." }, { status: 413 });
    }

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "delivery-image").trim() || "delivery-image";
    const ext = safeExtensionFromFilename(displayName);
    const storagePath = ext ? `orders/${orderId}/${documentId}.${ext}` : `orders/${orderId}/${documentId}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) return NextResponse.json({ error: toHebrewError(uploadError.message) }, { status: 400 });

    const uploadedAt = new Date().toISOString();
    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: "order_delivery_image",
      business_domain: "sales", // order documents always belong to the מכירות domain
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

    const { error: linkError } = await supabase.from("document_links").insert({
      document_id: documentId,
      entity_type: "order",
      entity_id: orderId,
    });
    if (linkError) {
      await supabase.from("documents").delete().eq("id", documentId);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
    }

    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);

    return NextResponse.json({
      image: {
        id: documentId,
        file_name: displayName,
        uploaded_at: uploadedAt,
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
      },
    });
  });
}
