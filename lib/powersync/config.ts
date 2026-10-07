// PowerSync — the on-device copy of the data (plan approved 2026-10-06:
// https://claude.ai/artifact/5jiMSB3waCTfFnyUuJnzU7). The device database
// syncs in the background for admins, office and workers; each page reads
// from it only behind its own switch below.

/** The PowerSync instance (EU). Dev instance until go-live, then production. */
export const POWERSYNC_URL =
  process.env.NEXT_PUBLIC_POWERSYNC_URL ?? "https://6ac3ebc2f0708554f16bfb92.powersync.journeyapps.com";

/** Folder the SDK's worker/.wasm files are served from (next.config.ts). */
export const POWERSYNC_ASSETS_BASE = process.env.NEXT_PUBLIC_POWERSYNC_ASSETS ?? "/powersync";

function isStaff(role: string | null | undefined): boolean {
  return role === "admin" || role === "office";
}

/**
 * Workers' device copy (approved 2026-10-07): their own share of the data —
 * their tasks and what those show, everyone's names, all customers, the open
 * orders (powersync/sync-config.yaml, the worker_* streams). `sync`: their
 * phones keep the copy and compare it with the server once a day per page,
 * nothing on screen changing; `pages`: their dashboard and tasks are drawn
 * from it — switched on only after a day of clean comparisons.
 */
export const LOCAL_DATA_WORKERS = { sync: true, pages: false } as const;

/** Who gets an on-device copy: admins and office, and workers (LOCAL_DATA_WORKERS). */
export function localDataEnabledFor(role: string | null | undefined): boolean {
  return isStaff(role) || (role === "worker" && LOCAL_DATA_WORKERS.sync);
}

/**
 * Pages that read from the device copy instead of the server. Each one flips
 * here only after it's been checked on real phones; flipping it back returns
 * that page to today's server version.
 */
export const LOCAL_DATA_PAGES = {
  // On for every admin and office user from 2026-10-06 (the owner's call: the
  // speed for everyone, and the timing and comparison reports from every
  // device). Each page still compares itself with the server's version once
  // a day per device (lib/powersync/device-check.ts).
  dashboard: true,
  projects: true,
  sales: true,
  tasks: true,
  // An order's own page (/sales/orders/<id>), from 2026-10-07 — its documents,
  // photos and history still come from the server, after the page.
  orders: true,
  // A project's own page (/projects/<id>) — needs sync rules v1.7 on the
  // device (account names, the VAT rate, recurring bills' names, login ids).
  // Off for everyone but the people trying it out until then.
  projectPage: false,
  // The dashboard's money cards (payments, collections, the income/expenses
  // chart) — needs sync rules v1.8 on the device (loans, card statements,
  // settlements…; only a copy that has them draws them, see money-copy.ts).
  // Off for everyone but the people trying it out until the comparisons come
  // out clean.
  dashboardMoney: false,
} as const;

/**
 * People (users.id) who already get the device version of every page that has
 * one, before its switch above is on for everyone — to try it on real phones.
 * Their own pages then skip the shadow check; everyone else's still runs it.
 */
export const LOCAL_DATA_PREVIEW_USERS: readonly string[] = [
  "2fcc692e-5bd7-41a1-b4c4-3aabfa7d580e", // the owner (admin), from 2026-10-06
];

/** Workers' pages that have a device version (the others are staff-only pages). */
const WORKER_DEVICE_PAGES: ReadonlySet<keyof typeof LOCAL_DATA_PAGES> = new Set(["dashboard", "tasks"]);

/** Does everyone with this role get the device version of `page`? */
export function localDataPageFor(page: keyof typeof LOCAL_DATA_PAGES, role: string | null | undefined): boolean {
  if (role === "worker") return LOCAL_DATA_WORKERS.sync && LOCAL_DATA_WORKERS.pages && WORKER_DEVICE_PAGES.has(page);
  return isStaff(role) && LOCAL_DATA_PAGES[page];
}

/** Does this person get the device version of `page`? */
export function localDataPageOn(page: keyof typeof LOCAL_DATA_PAGES, viewer: { id: string; role: string | null | undefined }): boolean {
  if (localDataPageFor(page, viewer.role)) return true;
  return isStaff(viewer.role) && LOCAL_DATA_PREVIEW_USERS.includes(viewer.id);
}

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
  orders: true,
  projectPage: true,
  dashboardMoney: true,
} as const;
