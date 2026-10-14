import { offlineFetch } from "@/lib/offline-queue";

export type PaymentPromiseUpdate = {
  status?: "pending" | "kept" | "broken" | "cancelled";
  amount?: number;
  promised_date?: string;
  notes?: string;
};

/**
 * Update a payment promise through its route (app/api/payment-promises/update,
 * admin/office), by way of the send queue: with no connection the change waits
 * on the device and goes out when it's back — `queued` says so. It used to be
 * a direct browser write, which simply failed offline, and the undo engine
 * then put the old status back on screen.
 */
export async function updatePaymentPromise(
  id: string,
  input: PaymentPromiseUpdate,
  label = "עדכון הבטחת תשלום"
): Promise<{ ok: true; queued: boolean } | { ok: false; error: string }> {
  const result = await offlineFetch("/api/payment-promises/update", { id, ...input }, label);
  if (result.queued) return { ok: true, queued: true };
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, queued: false };
}
