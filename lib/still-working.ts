/**
 * The server's answer to a save sent again while its first send is still being
 * worked on (lib/idempotency.ts): a 503 with `pending: true` — keep the save
 * and send it again shortly. Never a failure: it doesn't count toward giving
 * up on the save. Here, with nothing imported, for the phone's send queues.
 */
export function isStillWorking(status: number, body: unknown): boolean {
  return status === 503 && Boolean(body && typeof body === "object" && (body as { pending?: unknown }).pending === true);
}

/** How soon a save answered "still working" is sent again. */
export const STILL_WORKING_RETRY_MS = 10_000;
