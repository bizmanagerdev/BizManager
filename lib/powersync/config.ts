// PowerSync — the on-device copy of the data (plan approved 2026-10-06:
// https://claude.ai/artifact/5jiMSB3waCTfFnyUuJnzU7). Foundation stage: the
// device database syncs in the background for admins and office, and no page
// reads from it yet — each page moves over behind its own switch below.

/** The PowerSync instance (EU). Dev instance until go-live, then production. */
export const POWERSYNC_URL =
  process.env.NEXT_PUBLIC_POWERSYNC_URL ?? "https://6ac3ebc2f0708554f16bfb92.powersync.journeyapps.com";

/** Folder the SDK's worker/.wasm files are served from (next.config.ts). */
export const POWERSYNC_ASSETS_BASE = process.env.NEXT_PUBLIC_POWERSYNC_ASSETS ?? "/powersync";

/**
 * Who gets an on-device copy. The sync rules (powersync/sync-config.yaml)
 * only hand data to active admins and office users for now; workers come with
 * the dashboard step, together with their own rules.
 */
export function localDataEnabledFor(role: string | null | undefined): boolean {
  return role === "admin" || role === "office";
}

/**
 * Pages that read from the device copy instead of the server. Each one flips
 * here only after it's been checked on real phones; flipping it back returns
 * that page to today's server version.
 */
export const LOCAL_DATA_PAGES = {
  dashboard: false,
  projects: false,
  sales: false,
  tasks: false,
} as const;

/**
 * Pages whose cards are also worked out from the device copy in the
 * background and compared with the server's (nothing on screen changes) —
 * the check that has to come out clean before a page's switch above flips.
 * See lib/powersync/dashboard-shadow.ts.
 */
export const LOCAL_DATA_SHADOW = {
  dashboard: true,
  projects: true,
  sales: true,
  tasks: true,
} as const;
