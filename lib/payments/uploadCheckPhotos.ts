/**
 * Upload one or more check photos for a payment that has already been created.
 * Reuses the shared financial-attachments endpoint with entity_type=payment.
 * Failures are swallowed and reported via the return value so callers can decide
 * whether to surface a non-blocking warning to the user.
 */
export async function uploadCheckPhotos(paymentId: string, files: File[]): Promise<{ uploaded: number; failed: number }> {
  if (!paymentId || files.length === 0) return { uploaded: 0, failed: 0 };
  let uploaded = 0;
  let failed = 0;
  for (const file of files) {
    const form = new FormData();
    form.set("entity_type", "payment");
    form.set("entity_id", paymentId);
    form.set("file", file);
    try {
      const res = await fetch("/api/financial-attachments/upload", { method: "POST", body: form });
      if (res.ok) uploaded += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { uploaded, failed };
}
