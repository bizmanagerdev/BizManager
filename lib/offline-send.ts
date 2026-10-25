import { getQueueLength, isDeleteUrl, offlineFetch } from "@/lib/offline-queue";
import { getUploadQueueLength } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";

export type SendResult =
  { ok: true; queued: boolean; data: unknown } | { ok: false; error: string };

/**
 * A change sent through the send queue (offlineFetch): done once the server has it — or once it's kept on the
 * device to go out with the connection, the screen already showing it (an undo window's patch or hidden row stays).
 * A delete of what's already gone did what it was meant to.
 */
export async function sendChange(
  url: string,
  body: Record<string, unknown>,
  label: string,
  failText: string,
): Promise<SendResult> {
  const result = await offlineFetch(url, body, label);
  if (result.queued) return { ok: true, queued: true, data: null };
  if (result.ok) return { ok: true, queued: false, data: result.data };
  if (result.status === 404 && isDeleteUrl(url))
    return { ok: true, queued: false, data: null };
  return { ok: false, error: toHebrewError(result.error, failText) };
}

/** A save or a file still waiting on this device for the connection — or no connection at all. */
export async function savesWaiting(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (getQueueLength() > 0) return true;
  try {
    return (await getUploadQueueLength()) > 0;
  } catch {
    return false;
  }
}
