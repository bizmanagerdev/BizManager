import { offlineUpload, queueUploadsAfter } from "@/lib/offline-upload";
import { uploadTogether } from "@/lib/upload-together";

/**
 * Upload one or more check photos for a payment that has already been created.
 * Reuses the shared financial-attachments endpoint with entity_type=payment.
 *
 * Goes through offlineUpload so a photo taken on a poor/no connection is saved
 * to the device and replayed when the connection returns (instead of hanging or
 * being lost) — the endpoint is idempotency-guarded so a replay is duplicate-safe.
 * Connection feedback (slow / saved-on-device / synced) is surfaced globally by
 * ConnectionToasts; failures here are reported via the return value so callers
 * can decide whether to also show a non-blocking warning.
 */
export async function uploadCheckPhotos(
  paymentId: string,
  files: File[]
): Promise<{ uploaded: number; failed: number; queued: number }> {
  if (!paymentId) return { uploaded: 0, failed: 0, queued: 0 };
  return uploadCheckPhotosForPayments([{ paymentId, files }]);
}

/**
 * Same, for several payments saved at once (an order paid with a run of
 * post-dated checks): every photo of every payment shares one upload pool
 * (lib/upload-together.ts), instead of one payment after another.
 */
export async function uploadCheckPhotosForPayments(
  payments: Array<{ paymentId: string; files: File[] }>
): Promise<{ uploaded: number; failed: number; queued: number }> {
  const items = payments.flatMap(({ paymentId, files }) =>
    paymentId ? files.map((file) => ({ paymentId, file })) : []
  );
  let uploaded = 0;
  let failed = 0;
  let queued = 0;
  if (items.length === 0) return { uploaded, failed, queued };
  const results = await uploadTogether(items, ({ paymentId, file }) =>
    offlineUpload("/api/financial-attachments/upload", {
      fields: { entity_type: "payment", entity_id: paymentId },
      file,
      label: "תמונת הצ׳ק",
    })
  );
  for (const result of results) {
    if (result.queued) queued += 1;
    else if (result.ok) uploaded += 1;
    else failed += 1;
  }
  return { uploaded, failed, queued };
}

/**
 * The files of a payment or expense whose save waited for the connection
 * (offlineFetch's queued result): kept on the device and attached once that
 * save has reached the server — `idPath` is where its answer holds the new id
 * ("payment.id", "expense.id"). They used to be dropped (owner, 2026-10-11).
 * No key (a save without an idempotency key): nothing to wait on — dropped.
 */
export async function queueFinancialAttachmentsAfter(
  key: string | undefined,
  idPath: string,
  entityType: "expense" | "payment" | "session",
  files: File[]
): Promise<void> {
  if (!key || files.length === 0) return;
  await queueUploadsAfter(
    { key, idPath },
    files.map((file) => ({
      url: "/api/financial-attachments/upload",
      fields: { entity_type: entityType, entity_id: "{id}" },
      file,
      label: file.name || "קובץ",
    }))
  );
}
