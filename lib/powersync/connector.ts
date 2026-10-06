import type { CommonPowerSyncDatabase, PowerSyncBackendConnector, PowerSyncCredentials } from "@powersync/web";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { withSentry } from "@/lib/sentry-lazy";
import { POWERSYNC_URL } from "./config";

// How the device copy talks to the outside world:
// - downloads: PowerSync checks the person's Supabase login token (its
//   instance is set up with Supabase auth) and sends what the sync rules allow;
// - uploads: none yet. Nothing writes to the device copy in the foundation
//   stage; local saves come with the tasks step, through our own API routes so
//   permission checks, notifications and translations keep running.

/** Refresh a token this close to expiry before handing it over. */
const REFRESH_WITHIN_MS = 60_000;

export class BizConnector implements PowerSyncBackendConnector {
  private reportedUnexpectedWrite = false;

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
    // Nothing should write locally yet. Keep the change queued (it isn't lost)
    // and say so once, rather than dropping it or uploading it nowhere.
    if (!this.reportedUnexpectedWrite) {
      this.reportedUnexpectedWrite = true;
      withSentry((Sentry) =>
        Sentry.captureMessage("PowerSync: a local write happened before local saves were enabled", {
          level: "warning",
          tags: { area: "powersync" },
          extra: { operations: transaction.crud.length, tables: [...new Set(transaction.crud.map((op) => op.table))] },
        })
      );
    }
    throw new Error("Local saves aren't enabled yet");
  }
}
