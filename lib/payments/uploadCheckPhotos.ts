import { offlineUpload } from "@/lib/offline-upload";

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
  if (!paymentId || files.length === 0) return { uploaded: 0, failed: 0, queued: 0 };
  let uploaded = 0;
  let failed = 0;
  let queued = 0;
  for (const file of files) {
    const result = await offlineUpload("/api/financial-attachments/upload", {
      fields: { entity_type: "payment", entity_id: paymentId },
      file,
      label: "תמונת הצ׳ק",
    });
    if (result.queued) queued += 1;
    else if (result.ok) uploaded += 1;
    else failed += 1;
  }
  return { uploaded, failed, queued };
}
