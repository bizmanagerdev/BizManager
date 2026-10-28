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
 * from it (and their task saves made on it first) — on from 2026-10-08, after
 * a day of clean comparisons (the owner's call). Except for workers reading
 * Arabic: the server translates task names as they read them, the phone
 * can't — their pages stay on the server (the owner's call, same day).
 */
export const LOCAL_DATA_WORKERS = { sync: true, pages: true } as const;

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
  // On for every admin and office user from 2026-10-08 (the owner's call,
  // after its daily comparisons on the owner's phone came out clean).
  projectPage: true,
  // The dashboard's money cards (payments, collections, the income/expenses
  // chart) — needs sync rules v1.8 on the device (loans, card statements,
  // settlements…; only a copy that has them draws them, see money-copy.ts).
  // On for every admin and office user from 2026-10-11 (the owner's call, after
  // a week of comparisons: the two differences found were two same-day bills
  // in a different order, since fixed, and a check taken 1.4s after an income
  // was saved — the server's page was drawn just before it).
  dashboardMoney: true,
  // The drivers' deliveries page (/deliveries) — owner, 2026-10-11: "let's
  // download that also to the phone", so a run works with no signal. The same
  // list as the deliveries tab (/sales, on for staff above).
  deliveries: true,
  // The customers list (/customers) — on the owner's devices from 2026-10-20,
  // every admin and office user's from 2026-10-23 (owner: "do all 3"), after
  // its comparisons came out clean on two devices and against the live data
  // (every page of the list). Searches stay on the server.
  customers: true,
  // A customer's page (/customers/<id>) — the same dates; checked against the
  // live data for the 80 busiest customers on 2026-10-23, all the same. What
  // only the server reads (the call log, promises, Morning documents, a linked
  // worker's pay owed — owner: "leave out those tables", 2026-10-20 — the
  // documents and history) follows from the server after the page.
  customerPage: true,
  // The properties list (/properties) — on the owner's devices from 2026-10-21,
  // every admin and office user's from 2026-10-24 (owner: "do 5"), after its
  // comparisons came out clean (Oct 21–24, two devices; none differed).
  properties: true,
  // A property's page (/properties/<id>) — the same dates; still clean after
  // the companies and zoning columns (Oct 24). Its documents, files and
  // recurring bills follow from the server after the page.
  propertyPage: true,
  // The rent roll (/rent) — the same dates.
  rentRoll: true,
  // The accounts page (/financial/bank, admins only) — owner, 2026-10-27: "go
  // with accounts to make the list device copy offline". Needs sync rules v1.14
  // on the device (transfers, the bank-check ticks, the exchange rates — see
  // BANK_COPY_COOKIE in lib/powersync/money-copy.ts). The preview users' first;
  // every admin's from 2026-10-28 (owner: "go on with turned on for all
  // admins"), after the owner's copy matched the server's (Oct 28) and the
  // page passed its checks at every width and text size.
  bank: true,
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
const WORKER_DEVICE_PAGES: ReadonlySet<keyof typeof LOCAL_DATA_PAGES> = new Set(["dashboard", "tasks", "deliveries"]);

/**
 * Does everyone with this role (and, for a worker, this locale) get the device
 * version of `page`? A worker's locale has to be known — a worker reading
 * Arabic stays on the server (LOCAL_DATA_WORKERS).
 */
export function localDataPageFor(
  page: keyof typeof LOCAL_DATA_PAGES,
  role: string | null | undefined,
  locale?: string | null
): boolean {
  if (role === "worker") {
    return (
      LOCAL_DATA_WORKERS.sync && LOCAL_DATA_WORKERS.pages && WORKER_DEVICE_PAGES.has(page) && Boolean(locale) && locale !== "ar"
    );
  }
  return isStaff(role) && LOCAL_DATA_PAGES[page];
}

/** Does this person get the device version of `page`? */
export function localDataPageOn(
  page: keyof typeof LOCAL_DATA_PAGES,
  viewer: { id: string; role: string | null | undefined; locale?: string | null }
): boolean {
  if (localDataPageFor(page, viewer.role, viewer.locale)) return true;
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
  customers: true,
  customerPage: true,
  properties: true,
  propertyPage: true,
  rentRoll: true,
  bank: true,
} as const;
