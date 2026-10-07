import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntityAuditTrail, getLatestAuditByRecordIds, type AuditFeedItem } from "@/lib/audit";
import { STORAGE_BUCKET } from "@/lib/storage";
import type { MorningLocalDocument } from "@/lib/morning/types";
import type { DeliveryImage } from "@/app/(app)/sales/orders/[id]/DeliveryImagesCard";

// The parts of an order's page only the server can read: its Morning
// documents, its delivery photos (signed links), when each payment was entered
// by whom from the change log (for payments whose recorded_by names nobody),
// and — for admins — its history. The order itself is in
// lib/orders/order-page.ts, which the device copy can read too.

type Row = Record<string, unknown>;

export type OrderPageExtras = {
  /** The order's documents and its payments' (each once), newest first. */
  morningDocuments: MorningLocalDocument[];
  deliveryImages: DeliveryImage[];
  /** The change log's latest entry for each payment, by payment id. */
  paymentAudit: Record<string, { action: string; actorName: string; createdAt: string | null }>;
  /** The order's history — null when this person doesn't see it (admins only). */
  activity: AuditFeedItem[] | null;
  errors: { deliveryLinks: string | null; orderDocuments: string | null; paymentDocuments: string | null };
};

const MORNING_DOC_SELECT =
  "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes";

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

type ExtrasInput = { id: string; paymentIds: Promise<string[]>; withActivity: Promise<boolean> };

/**
 * Every read goes out at once, each as soon as what it needs is in.
 * `paymentIds`: the order's payments (their documents and log entries);
 * `withActivity`: whether this person sees the history — the read starts once
 * that's known. Never fails: what couldn't be read is reported on the page
 * (the device version is handed this as it comes, after the page).
 */
export function loadOrderPageExtras(supabase: SupabaseClient, input: ExtrasInput): Promise<OrderPageExtras> {
  return readOrderPageExtras(supabase, input).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return {
      morningDocuments: [],
      deliveryImages: [],
      paymentAudit: {},
      activity: [],
      errors: { deliveryLinks: message, orderDocuments: message, paymentDocuments: null },
    };
  });
}

async function readOrderPageExtras(
  supabase: SupabaseClient,
  { id, paymentIds, withActivity }: ExtrasInput
): Promise<OrderPageExtras> {
  const orderDocumentsRead = Promise.resolve(
    supabase.from("morning_documents").select(MORNING_DOC_SELECT).eq("order_id", id).order("issued_at", { ascending: false })
  );
  const paymentDocumentsRead = paymentIds.then(async (ids) => {
    if (ids.length === 0) return { data: [] as Row[], error: null };
    const { data, error } = await supabase
      .from("morning_documents")
      .select(MORNING_DOC_SELECT)
      .in("payment_id", ids)
      .order("issued_at", { ascending: false });
    return { data: (data ?? []) as Row[], error };
  });
  const paymentAuditRead = paymentIds.then((ids) => getLatestAuditByRecordIds(supabase, { tableName: "payments", recordIds: ids }));
  const deliveryLinksRead = Promise.resolve(
    supabase.from("document_links").select("document_id,created_at").eq("entity_type", "order").eq("entity_id", id)
  );
  // The delivery photos: their documents, then every one signed in ONE
  // storage call (was one request per image).
  const deliveryImagesRead = deliveryLinksRead.then(async ({ data: links }) => {
    const linkRows = (links ?? []) as Row[];
    const documentIds = uniqueStrings(linkRows.map((link) => getString(link, "document_id")));
    if (documentIds.length === 0) return [] as DeliveryImage[];
    const { data: deliveryDocuments } = await supabase
      .from("documents")
      .select("id,file_name,storage_key,uploaded_at,document_type")
      .in("id", documentIds);

    const deliveryDocumentMap = new Map<string, Row>();
    ((deliveryDocuments ?? []) as Row[]).forEach((row) => {
      const documentId = getString(row, "id");
      if (documentId) deliveryDocumentMap.set(documentId, row);
    });

    const deliveryImageDocs = linkRows
      .map((link) => {
        const documentId = getString(link, "document_id");
        const document = documentId ? deliveryDocumentMap.get(documentId) : null;
        if (!documentId || !document) return null;
        if (getString(document, "document_type") !== "order_delivery_image") return null;
        const storageKey = getString(document, "storage_key");
        if (!storageKey) return null;
        return {
          id: documentId,
          storageKey,
          file_name: getString(document, "file_name"),
          uploaded_at: getString(document, "uploaded_at") ?? getString(link, "created_at"),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const signedUrlByKey = new Map<string, string>();
    if (deliveryImageDocs.length > 0) {
      const { data: signedList } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(
        deliveryImageDocs.map((d) => d.storageKey),
        60 * 60
      );
      (signedList ?? []).forEach((entry) => {
        if (entry && typeof entry.path === "string" && typeof entry.signedUrl === "string") {
          signedUrlByKey.set(entry.path, entry.signedUrl);
        }
      });
    }

    return deliveryImageDocs.map((d) => ({
      id: d.id,
      file_name: d.file_name,
      uploaded_at: d.uploaded_at,
      url: signedUrlByKey.get(d.storageKey) ?? null,
    }));
  });
  // This order's own change history plus payments recorded against it — admin
  // only, mirroring /activity access.
  const activityRead = withActivity.then((show) =>
    show
      ? getEntityAuditTrail(supabase, [
          { tableName: "orders", recordId: id },
          { tableName: "payments", jsonKey: "order_id", value: id },
        ]).then((trail) => trail.items)
      : null
  );

  const [orderDocuments, paymentDocuments, paymentAudit, deliveryLinks, deliveryImages, activity] = await Promise.all([
    orderDocumentsRead,
    paymentDocumentsRead,
    paymentAuditRead,
    deliveryLinksRead,
    deliveryImagesRead,
    activityRead,
  ]);

  const morningDocuments = Array.from(
    new Map(
      [...((orderDocuments.data ?? []) as Row[]), ...((paymentDocuments.data ?? []) as Row[])].map((row) => [
        getString(row, "id") ?? "",
        row,
      ])
    ).values()
  ).filter((row) => Boolean(getString(row, "id"))) as MorningLocalDocument[];

  return {
    morningDocuments,
    deliveryImages,
    paymentAudit: Object.fromEntries(
      Object.entries(paymentAudit.byRecordId).map(([paymentId, entry]) => [
        paymentId,
        { action: entry.action, actorName: entry.actorName, createdAt: entry.createdAt },
      ])
    ),
    activity,
    errors: {
      deliveryLinks: deliveryLinks.error?.message ?? null,
      orderDocuments: orderDocuments.error?.message ?? null,
      paymentDocuments: paymentDocuments.error?.message ?? null,
    },
  };
}
