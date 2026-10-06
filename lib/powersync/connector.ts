import type { CommonPowerSyncDatabase, PowerSyncBackendConnector, PowerSyncCredentials } from "@powersync/web";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { withSentry } from "@/lib/sentry-lazy";
import { POWERSYNC_URL } from "./config";
import { DEVICE_SAVE_REFUSED_EVENT, requestForChange, type DeviceSaveRefused, type DeviceSaveRequest } from "./local-writes";

// How the device copy talks to the outside world:
// - downloads: PowerSync checks the person's Supabase login token (its
//   instance is set up with Supabase auth) and sends what the sync rules allow;
// - uploads: saves made on the device copy (lib/powersync/local-writes.ts —
//   the tasks board's moves, reorders and deletes) go through our own API
//   routes, so permission checks, reminders and the history log keep running.

/** Refresh a token this close to expiry before handing it over. */
const REFRESH_WITHIN_MS = 60_000;

/**
 * A change the server keeps failing (an outage, a bug) is dropped after this
 * many tries: while anything is waiting to go up, PowerSync holds back what
 * comes down, so one stuck change would freeze the whole copy.
 */
const MAX_TRIES = 6;

/** Try again later. `counts`: a server failure (counted toward MAX_TRIES) — not just no connection. */
class RetryLater extends Error {
  constructor(message: string, readonly counts: boolean) {
    super(message);
  }
}

function reportDropped(request: DeviceSaveRequest | null, reason: string, extra: Record<string, unknown> = {}) {
  withSentry((Sentry) =>
    Sentry.captureMessage("PowerSync: a device save was dropped", {
      level: "warning",
      tags: { area: "powersync", device_save: request?.kind ?? "unknown" },
      extra: { reason, ...extra },
    })
  );
}

/** Tell the page (a toast) that the server refused one of its saves. */
function announceRefusal(detail: DeviceSaveRefused) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DEVICE_SAVE_REFUSED_EVENT, { detail }));
}

/** Send one change; throws RetryLater when it should be tried again. */
async function send(request: DeviceSaveRequest): Promise<void> {
  let res: Response;
  try {
    res = await fetch(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(request.body),
    });
  } catch {
    // No signal: it waits as long as it takes (never dropped for this).
    throw new RetryLater("no connection", false);
  }
  if (res.ok) return;
  // Deleting something that's already gone did what it was meant to.
  if (request.kind === "task-delete" && res.status === 404) return;
  // Signed out for a moment, overloaded, or the server itself failing: later.
  if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) {
    throw new RetryLater(`HTTP ${res.status}`, true);
  }
  // Refused (not allowed, gone, invalid): drop it — the copy goes back to the
  // server's version at the next sync — and say why.
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  const message = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
  announceRefusal({ kind: request.kind, message });
  reportDropped(request, "refused", { status: res.status, message });
}

export class BizConnector implements PowerSyncBackendConnector {
  /** Failed tries per queued change (its clientId), for MAX_TRIES. */
  private tries = new Map<number, number>();
  /** Changes already sent from a batch that's being retried — not sent twice. */
  private sent = new Set<number>();

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error; // network trouble: PowerSync retries
    let session = data.session;
    if (!session) return null; // signed out: stop syncing
    if (session.expires_at && session.expires_at * 1000 - Date.now() < REFRESH_WITHIN_MS) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) throw refreshed.error;
      session = refreshed.data.session;
      if (!session) return null;
    }
    return { endpoint: POWERSYNC_URL, token: session.access_token };
  }

  async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const currentStatus = async (id: string) =>
      (await database.getOptional<{ status: string | null }>("SELECT status FROM tasks WHERE id = ?", [id]))?.status ?? null;

    for (const op of transaction.crud) {
      if (this.sent.has(op.clientId)) continue;
      const request = await requestForChange(op, currentStatus);
      if (!request) {
        // Nothing sends this kind of change (yet): drop it rather than block the queue.
        reportDropped(null, "no route for this change", { table: op.table, op: op.op });
        continue;
      }
      try {
        await send(request);
        this.tries.delete(op.clientId);
        this.sent.add(op.clientId);
      } catch (error) {
        if (!(error instanceof RetryLater)) throw error;
        if (!error.counts) throw error;
        const tries = (this.tries.get(op.clientId) ?? 0) + 1;
        this.tries.set(op.clientId, tries);
        // PowerSync calls uploadData again shortly — the same change, from here.
        if (tries < MAX_TRIES) throw error;
        this.tries.delete(op.clientId);
        announceRefusal({ kind: request.kind, message: error.message });
        reportDropped(request, "kept failing", { tries, last: error.message });
      }
    }
    await transaction.complete();
    for (const op of transaction.crud) this.sent.delete(op.clientId);
  }
}
