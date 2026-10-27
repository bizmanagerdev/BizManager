import net from "node:net";
import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, type TestCustomer } from "./db";
import { DEVICE_COPY_PENDING_COOKIE } from "@/lib/powersync/device-pending";

// The app with no connection, clicked through the way the owner tested it by
// hand on a laptop (Oct 24–27: pages not saved for offline, "+" breaking the
// whole app, two bars, a bar that came and went). Runs in the "offline"
// project (playwright.config.ts): the production build on a .test address,
// where the service worker (public/sw.js) runs as it does on biz-h.com. Each
// test signs in on a fresh browser — its own service worker and saved pages.
//
// Covered: pages saved whole by the service worker, the whole app's code
// (SAVE_APP_CODE), the red "no connection" bar, the "not saved" notice, the
// "+" task form and a refresh — on a device whose on-device copy (PowerSync)
// isn't ready. CI has no PowerSync service, so the device pages come as their
// server version (DEVICE_COPY_PENDING_COOKIE), as on a phone whose network
// blocks the sync service. Not covered yet: the device pages' saved frames
// (SAVE_FRAMES, OfflineMenuFrames) and saves made offline — see e2e/README.md.

/** The app's server, and the switch in front of it the browser goes through (playwright.config.ts: bizh.test:3100). */
const SERVER_PORT = 3000;
const SWITCH_PORT = 3100;

/**
 * The server, behind a switch: off, every connection is cut at once — the
 * server doesn't answer, whatever the device says. The browser's own offline
 * switch (setOffline) is the device saying so; this is the network itself,
 * the service worker's requests included.
 */
function serverSwitch() {
  let answering = true;
  const open = new Set<net.Socket>();
  const server = net.createServer((client) => {
    if (!answering) {
      client.destroy();
      return;
    }
    const upstream = net.connect(SERVER_PORT, "127.0.0.1");
    open.add(client);
    const close = () => {
      open.delete(client);
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close).on("close", close);
    upstream.on("error", close).on("close", close);
    client.pipe(upstream).pipe(client);
  });
  return {
    start: () => new Promise<void>((resolve) => server.listen(SWITCH_PORT, "127.0.0.1", resolve)),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    set: (on: boolean) => {
      answering = on;
      if (!on) for (const socket of open) socket.destroy();
    },
  };
}

// The service worker runs only in a production build — what CI serves; a
// local run serves `next dev` (playwright.config.ts webServer).
test.skip(!process.env.CI, "needs the production build that CI serves (next dev has no service worker)");

const server = serverSwitch();
test.beforeAll(() => server.start());
test.afterEach(() => server.set(true));
test.afterAll(() => server.stop());

/** Menu pages opened online — loaded whole, so the service worker keeps them (PAGES_CACHE). */
const SAVED_PAGES = [
  { link: "דשבורד", path: "/dashboard" },
  { link: "משימות", path: "/tasks" },
  { link: "פרויקטים", path: "/projects" },
  { link: "מכירות", path: "/sales" },
  { link: "לקוחות", path: "/customers" },
];
/** A menu page never opened: not on the device. */
const UNSAVED_PAGE = { link: "יומן", path: "/calendar" };

/** The red bar's text (components/layout/OfflineBanner) — not the yellow saved-copy one ("אין חיבור לשרת"). */
const RED_BAR = /^אין חיבור(?: לאינטרנט)? — /;
const SAVED_COPY_NOTICE = "מוצגת הגרסה השמורה במכשיר"; // components/layout/SavedCopyNotice
const NOT_SAVED_NOTICE = "הדף הזה לא שמור במכשיר"; // components/pwa/PwaRegistration
/** A page that broke: the app's error screens, and the service worker's own "no connection" page. */
const BROKEN_PAGE_HEADINGS = ["אירעה תקלה בטעינת הדף", "אירעה שגיאה", "אין חיבור לאינטרנט"];

/**
 * Runs in every page: notes each time the red bar shows or goes, every 50 ms,
 * so a bar that came and went between two checks is still seen (owner,
 * 2026-10-27: "these bars appear then disappear then reappear").
 */
function watchRedBar() {
  const log: { at: number; on: boolean }[] = [];
  (window as unknown as { __redBar: typeof log }).__redBar = log;
  let last: boolean | null = null;
  setInterval(() => {
    const on = Array.from(document.querySelectorAll("span")).some(
      (el) => /^אין חיבור(?: לאינטרנט)? — /.test(el.textContent ?? "") && el.getClientRects().length > 0
    );
    if (on === last) return;
    last = on;
    log.push({ at: Math.round(performance.now()), on });
  }, 50);
}

function menuLink(page: Page, name: string) {
  return page.locator("aside nav").getByRole("link", { name });
}

/**
 * Click, and wait for the page that loads. With no connection every move is a
 * whole-page load: Next.js gives up on the page's data request and loads it
 * whole, which the service worker answers from the device.
 */
async function moveWith(page: Page, link: Locator) {
  await page.evaluate(() => {
    (window as unknown as { __left?: boolean }).__left = true;
  });
  await link.click();
  await page.waitForFunction(
    () => !(window as unknown as { __left?: boolean }).__left && document.readyState === "complete"
  );
}

async function expectNotBroken(page: Page) {
  for (const name of BROKEN_PAGE_HEADINGS) {
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  }
}

async function expectOpen(page: Page, path: string) {
  await expect(page).toHaveURL((url) => url.pathname === path);
  await expect(page.locator("main")).toBeVisible();
  await expectNotBroken(page);
}

/** One red bar, no second (saved-copy) bar, and the red one never gone since it first showed on this page. */
async function expectSteadyRedBar(page: Page) {
  await expect(page.getByText(RED_BAR).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText(SAVED_COPY_NOTICE).filter({ visible: true })).toHaveCount(0);
  const log = await page.evaluate(() => (window as unknown as { __redBar?: { at: number; on: boolean }[] }).__redBar ?? []);
  const shown = log.findIndex((entry) => entry.on);
  expect(shown, "the red bar never showed").toBeGreaterThanOrEqual(0);
  expect(
    log.slice(shown).every((entry) => entry.on),
    `the red bar went and came back on ${page.url()}: ${JSON.stringify(log)}`
  ).toBe(true);
}

/** This device's saved whole pages (the service worker's bizh-pages-<build>), as paths. */
function savedPages(page: Page) {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith("bizh-pages-")) continue;
      for (const request of await (await caches.open(name)).keys()) {
        const url = new URL(request.url);
        if (!url.searchParams.has("_rsc")) paths.push(url.pathname);
      }
    }
    return paths;
  });
}

/**
 * Ask the service worker for the whole app's code, and the build it's for —
 * the message the app sends (lib/powersync/device-frames.ts saveAppCode).
 * The app asks once its on-device copy has synced (OfflineMenuFrames), which
 * never happens in CI, so the test asks the same way.
 */
function askForAppCode(page: Page) {
  return page.evaluate(() => {
    const worker = navigator.serviceWorker.controller!;
    const build = new URL(worker.scriptURL).searchParams.get("v") ?? "";
    worker.postMessage({ type: "SAVE_APP_CODE", build, dpl: "" });
    return build;
  });
}

/** Done: every file on the build's list is on the device (public/sw.js marks it only then). */
function appCodeSaved(page: Page, build: string) {
  return page.evaluate(async (build) => {
    const cache = await caches.open(`bizh-static-${build}`);
    return Boolean(await cache.match(`${location.origin}/__bizh-app-code-${build}`));
  }, build);
}

/**
 * The "+" forms' lists, kept on the device for offline (QuickCreateMenu →
 * lib/offline-cache). Looked for without opening the database where it doesn't
 * exist yet: opening it here would create it without its table.
 */
function quickCreateListsSaved(page: Page) {
  return page.evaluate(async () => {
    const DB = "biz_offline_reads";
    if (!(await indexedDB.databases()).some((db) => db.name === DB)) return false;
    return new Promise<boolean>((resolve) => {
      const opening = indexedDB.open(DB);
      opening.onerror = () => resolve(false);
      opening.onsuccess = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains("snapshots")) {
          db.close();
          resolve(false);
          return;
        }
        const keys = db.transaction("snapshots").objectStore("snapshots").getAllKeys();
        keys.onsuccess = () => {
          db.close();
          resolve(keys.result.some((key) => String(key).startsWith("quick-create-data:")));
        };
        keys.onerror = () => {
          db.close();
          resolve(false);
        };
      };
    });
  });
}

/**
 * Online: sign in, let the service worker take over, open the menu pages and a
 * customer's page whole, and wait for what's saved in the background — the
 * pages, the whole app's code and the "+" forms' lists. Ends on the dashboard.
 */
async function openPagesOnline(page: Page, context: BrowserContext, baseURL: string, customer: TestCustomer) {
  // A device whose on-device copy isn't ready: the device pages come as their
  // server version at once (lib/powersync/device-pending.ts).
  await context.addCookies([{ name: DEVICE_COPY_PENDING_COOKIE, value: "1", url: baseURL }]);
  await context.addInitScript(watchRedBar);

  await loginAs(page, "admin");
  expect(
    await page.evaluate(() => window.isSecureContext),
    "the browser doesn't treat the .test address as secure (playwright.config.ts, project \"offline\")"
  ).toBe(true);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 30_000 });

  const opened = [...SAVED_PAGES.map(({ path }) => path), `/customers/${customer.id}`];
  for (const path of opened) {
    await page.goto(path);
    await expectOpen(page, path);
  }
  await expect
    .poll(() => savedPages(page), { message: "pages saved by the service worker", timeout: 30_000 })
    .toEqual(expect.arrayContaining(opened));

  await page.goto("/dashboard");
  const build = await askForAppCode(page);
  await expect
    .poll(() => appCodeSaved(page, build), { message: "the whole app's code saved", timeout: 120_000, intervals: [2000] })
    .toBe(true);
  // Fetched while the page is idle (QuickCreateMenu warmQuickCreate) — about 10 s in.
  await expect
    .poll(() => quickCreateListsSaved(page), { message: "the + forms' lists saved", timeout: 60_000, intervals: [2000] })
    .toBe(true);
}

test.describe("offline", () => {
  test.describe.configure({ timeout: 300_000 });

  test("network off: saved pages open, an unsaved one says so, + opens the task form, a refresh loads", async ({
    page,
    context,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(`${page.url()} — ${error.message}`));
    const customer = await createTestCustomer();
    try {
      await openPagesOnline(page, context, baseURL!, customer);

      // As in airplane mode: the device says it's offline, and nothing answers.
      await context.setOffline(true);
      server.set(false);
      await expectSteadyRedBar(page);

      // Moving between saved pages inside the app: each opens, with one red bar that stays.
      for (const { link, path } of [...SAVED_PAGES.slice(1), SAVED_PAGES[0]]) {
        await moveWith(page, menuLink(page, link));
        await expectOpen(page, path);
        await expectSteadyRedBar(page);
      }

      // A page never opened: the app stays where it is and says so (owner,
      // 2026-10-24: "the whole app basically crashed") — and keeps working.
      await menuLink(page, UNSAVED_PAGE.link).click();
      await expect(page.getByText(NOT_SAVED_NOTICE)).toBeVisible();
      await expectOpen(page, "/dashboard");
      await expectSteadyRedBar(page);
      await moveWith(page, menuLink(page, "לקוחות"));
      await expectOpen(page, "/customers");

      // A customer's page, from the saved list.
      await moveWith(page, page.getByRole("link", { name: customer.name }).filter({ visible: true }).first());
      await expectOpen(page, `/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
      await expectSteadyRedBar(page);

      // "+" → task: the form opens from the code and lists on the device
      // (owner, 2026-10-27: "+" offline, then "אירעה שגיאה").
      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      await page.getByRole("button", { name: "משימה", exact: true }).click();
      await expect(page.getByPlaceholder("שם המשימה")).toBeVisible();
      await expectNotBroken(page);
      await page.keyboard.press("Escape");

      // A refresh with no connection: the saved copy loads.
      await page.reload();
      await expectOpen(page, `/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
      await expectSteadyRedBar(page);

      // Back online: the bar goes, and the saved copy on screen is replaced by the live page.
      server.set(true);
      await context.setOffline(false);
      await expect(page.getByText(RED_BAR).filter({ visible: true })).toHaveCount(0, { timeout: 20_000 });
      await expect(page.locator("html")).not.toHaveAttribute("data-bizh-saved", /.*/, { timeout: 30_000 });
      await expectOpen(page, `/customers/${customer.id}`);
    } finally {
      if (pageErrors.length > 0) test.info().annotations.push({ type: "page errors", description: pageErrors.join("\n") });
      await deleteTestCustomer(customer.id);
    }
  });

  test("server not answering while the device says it's online: saved pages open, one red bar that stays", async ({
    page,
    context,
    baseURL,
  }) => {
    // The owner's laptop with its Wi-Fi off (2026-10-27): another network
    // adapter keeps the device "online", so only the server's silence tells
    // (lib/pwa/connection.ts).
    const customer = await createTestCustomer();
    try {
      await openPagesOnline(page, context, baseURL!, customer);

      server.set(false);
      // Found by a request failing: moving to a saved page.
      for (const { link, path } of [SAVED_PAGES[1], SAVED_PAGES[2], SAVED_PAGES[4], SAVED_PAGES[0]]) {
        await moveWith(page, menuLink(page, link));
        await expectOpen(page, path);
        await expectSteadyRedBar(page);
      }

      server.set(true);
      await expect(page.getByText(RED_BAR).filter({ visible: true })).toHaveCount(0, { timeout: 20_000 });
      await expect(page.locator("html")).not.toHaveAttribute("data-bizh-saved", /.*/, { timeout: 30_000 });
    } finally {
      await deleteTestCustomer(customer.id);
    }
  });
});
