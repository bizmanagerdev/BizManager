import type { CommonPowerSyncDatabase, PowerSyncBackendConnector, PowerSyncCredentials } from "@powersync/web";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { withSentry } from "@/lib/sentry-lazy";
import { isStillWorking } from "@/lib/still-working";
import { POWERSYNC_URL } from "./config";
import { changeKey, deviceCopyId } from "./copy-id";
import {
  DEVICE_SAVE_REFUSED_EVENT,
  DEVICE_SAVE_SENT_EVENT,
  goneIsDone,
  isCarriedChange,
  requestForChange,
  restoreForChange,
  type DeviceSaveRefused,
  type OrderRestore,
  type DeviceSaveRequest,
  type DeviceSaveSent,
} from "./local-writes";
import { rowName } from "./device-saves-waiting";
import {
  announceParked,
  announceParkedSent,
  hasParkedFor,
  listParkedSaves,
  noteParkedTry,
  parkedLabel,
  parkSave,
  removeParkedSave,
  reportParked,
} from "./parked-saves";

// How the device copy talks to the outside world:
// - downloads: PowerSync checks the person's Supabase login token (its
//   instance is set up with Supabase auth) and sends what the sync rules allow;
// - uploads: saves made on the device copy (lib/powersync/local-writes.ts —
//   tasks created, edited, moved, deleted; comments added; customers,
//   projects and orders created, projects and orders edited; the accounts
//   page's quick line, ticks and deletes) go through our own
//   API routes, so permission checks, notifications, reminders and the
//   history log keep running. Each carries an Idempotency-Key, so a change
//   sent again after its answer was lost is never applied twice.

/** Refresh a token this close to expiry before handing it over. */
const REFRESH_WITHIN_MS = 60_000;

/**
 * A change the server keeps failing (an outage, a bug) is parked once it has
 * failed for this long (lib/powersync/parked-saves.ts), to be sent again from
 * there: while anything is waiting to go up, PowerSync holds back what comes
 * down, so one stuck change would freeze the whole copy. Until then PowerSync
 * tries it again every few seconds. It used to be dropped after 6 tries (~30 s).
 */
export const PARK_AFTER_MS = 2 * 60_000;

/** Try again later. `counts`: a server failure (it counts toward PARK_AFTER_MS) — not just no connection. */
class RetryLater extends Error {
  constructor(message: string, readonly counts: boolean) {
    super(message);
  }
}

/** After a 401: a fresh login token, if one can be had (the cookie the routes read is updated with it). */
async function refreshedLogin(): Promise<boolean> {
  try {
    const { data, error } = await createSupabaseBrowserClient().auth.refreshSession();
    return !error && Boolean(data.session);
  } catch {
    return false;
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

/** Tell pages a change has reached the server (those drawn by the server refresh). */
function announceSent(detail: DeviceSaveSent) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DEVICE_SAVE_SENT_EVENT, { detail }));
}

/**
 * Send one change: "sent", or "refused" (dropped, and said why); throws
 * RetryLater when it should be tried again. `key`: the change's own
 * Idempotency-Key. `restore`: a new order's form, put back as its draft if
 * it's refused.
 */
async function send(
  request: DeviceSaveRequest,
  key: string,
  restore: OrderRestore | null,
  loginRefreshed = false
): Promise<"sent" | "refused"> {
  let res: Response;
  try {
    res = await fetch(request.url, {
      method: request.method ?? "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      credentials: "same-origin",
      body: JSON.stringify(request.body),
    });
  } catch {
    // No signal: it waits as long as it takes (never dropped for this).
    throw new RetryLater("no connection", false);
  }
  if (res.ok) return "sent";
  // Deleting something that's already gone did what it was meant to.
  if (goneIsDone(request.kind) && res.status === 404) return "sent";
  // The login ran out (a phone woken after a while): a fresh one, and the same
  // change again at once — not a failure.
  if (res.status === 401 && !loginRefreshed && (await refreshedLogin())) return send(request, key, restore, true);
  // Its first send is still being worked on (lib/still-working.ts): later.
  // It used to be a 202, taken as sent — lost if that first send then failed.
  if (res.status === 503 && isStillWorking(res.status, await res.clone().json().catch(() => null))) {
    throw new RetryLater("still being saved", true);
  }
  // Signed out, overloaded, or the server itself failing: later.
  if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) {
    throw new RetryLater(`HTTP ${res.status}`, true);
  }
  // Refused (not allowed, gone, invalid): drop it — the copy goes back to the
  // server's version at the next sync — and say why.
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  const message = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
  announceRefusal({ kind: request.kind, message, ...(restore ? { restore } : {}) });
  reportDropped(request, "refused", { status: res.status, message });
  return "refused";
}

let retrying: Promise<void> | null = null;

/**
 * Send the parked saves again, oldest first (lib/powersync/parked-saves.ts).
 * One that goes up, or is refused, leaves the list; one that still can't waits
 * on, and the later saves of its row wait behind it. With no connection the
 * rest wait too. One run at a time.
 */
export function retryParkedSaves(database: CommonPowerSyncDatabase): Promise<void> {
  retrying ??= (async () => {
    try {
      const stuckRows = new Set<string>();
      for (const save of await listParkedSaves(database)) {
        const row = `${save.table}:${save.rowId}`;
        if (stuckRows.has(row)) continue;
        try {
          const result = await send(save.request, save.key, save.restore);
          await removeParkedSave(database, save.id);
          announceSent({ kind: save.request.kind, id: save.rowId });
          if (result === "sent") {
            announceParkedSent({ kind: save.request.kind, label: save.label });
            reportParked("went up", save, { tries: save.tries + 1 });
          }
        } catch (error) {
          if (!(error instanceof RetryLater)) throw error;
          await noteParkedTry(database, save.id, error.message);
          if (!error.counts) return;
          stuckRows.add(row);
        }
      }
    } finally {
      retrying = null;
    }
  })();
  return retrying;
}

export class BizConnector implements PowerSyncBackendConnector {
  /** When each queued change (its clientId) started failing on the server, for PARK_AFTER_MS. */
  private failingSince = new Map<number, number>();
  /** Changes already sent or parked from a batch that's being retried — not handled twice. */
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
    const copy = await deviceCopyId(database);
    const currentRow = (id: string, table: "tasks" | "projects") =>
      database.getOptional<Record<string, unknown>>(
        table === "projects"
          ? "SELECT * FROM projects WHERE id = ?"
          : "SELECT status, business_domain, project_id, property_id FROM tasks WHERE id = ?",
        [id]
      );

    for (const op of transaction.crud) {
      if (this.sent.has(op.clientId)) continue;
      // Written with an order on the phone: its request carries them.
      if (isCarriedChange(op)) continue;
      const request = await requestForChange(op, currentRow);
      if (!request) {
        // Nothing sends this kind of change (yet): drop it rather than block the queue.
        reportDropped(null, "no route for this change", { table: op.table, op: op.op });
        continue;
      }
      // The copy's own id, the row's id and the change's place in this copy's
      // queue: the same change always carries the same key, two changes never
      // share one (lib/powersync/copy-id.ts).
      const key = changeKey(copy, op);
      const restore = restoreForChange(op);
      const park = async (reason: string) => {
        const label = parkedLabel(request.kind, await rowName(database, op.table, op.id));
        await parkSave(database, { table: op.table, rowId: op.id, request, key, restore, label, error: reason });
        this.sent.add(op.clientId);
        announceParked({ kind: request.kind, label });
        reportParked("parked", { request }, { reason });
      };
      // A save of this row is waiting already: this one waits behind it, so
      // an older change never lands on top of a newer one.
      if (await hasParkedFor(database, op.table, op.id)) {
        await park("behind an earlier save of the same row");
        continue;
      }
      try {
        await send(request, key, restore);
        this.failingSince.delete(op.clientId);
        this.sent.add(op.clientId);
        announceSent({ kind: request.kind, id: op.id });
      } catch (error) {
        if (!(error instanceof RetryLater)) throw error;
        // No signal: it waits as long as it takes (the clock starts again once it's back).
        if (!error.counts) {
          this.failingSince.delete(op.clientId);
          throw error;
        }
        const since = this.failingSince.get(op.clientId) ?? Date.now();
        this.failingSince.set(op.clientId, since);
        // PowerSync calls uploadData again shortly — the same change, from here.
        if (Date.now() - since < PARK_AFTER_MS) throw error;
        this.failingSince.delete(op.clientId);
        await park(error.message);
      }
    }
    await transaction.complete();
    for (const op of transaction.crud) this.sent.delete(op.clientId);
  }
}
