import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, type TestCustomer } from "./db";
import {
  RED_BAR,
  appCodeSaved,
  expectNotBroken,
  expectOpen,
  expectOpensNotOnDevice,
  expectSteadyRedBar,
  menuLink,
  moveTo,
  savedAddresses,
  serverSwitch,
  watchRedBar,
  workerBuild,
} from "./offline-helpers";
import { DEVICE_COPY_PENDING_COOKIE } from "@/lib/powersync/device-pending";

// The app with no connection, clicked through the way the owner tested it by
// hand on a laptop (Oct 24–27: pages not saved for offline, "+" breaking the
// whole app, two bars, a bar that came and went). Runs in the "offline"
// project (playwright.config.ts): the production build on a .test address,
// where the service worker (public/sw.js) runs as it does on biz-h.com. Each
// test signs in on a fresh browser — its own service worker and saved pages.
//
// Covered: pages saved whole by the service worker, the whole app's code
// (SAVE_APP_CODE), the red "no connection" bar, a page not on the device
// saying so in its place, the "+" task form and a refresh — on a device whose
// on-device copy (PowerSync) isn't ready (DEVICE_COPY_PENDING_COOKIE): the
// device pages come as their server version, as on a phone whose network
// blocks the sync service. A
// device whose copy syncs — the device pages' saved frames, a save made
// offline — is offline-device-copy.spec.ts.

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

/**
 * Ask the service worker for the whole app's code — the message the app sends
 * (lib/powersync/device-frames.ts saveAppCode). With no ready copy, as here,
 * the app asks 3 minutes after it opened (OfflineMenuFrames); the test asks at
 * once the same way instead of waiting.
 */
async function askForAppCode(page: Page) {
  const build = await workerBuild(page);
  await page.evaluate((build) => {
    navigator.serviceWorker.controller!.postMessage({ type: "SAVE_APP_CODE", build, dpl: "" });
  }, build);
  return build;
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
    .poll(() => savedAddresses(page, "pages"), { message: "pages saved by the service worker", timeout: 30_000 })
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

  test("network off: saved pages open, an unsaved one opens saying so, + opens the task form, a refresh loads", async ({
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
        await moveTo(page, menuLink(page, link), path);
        await expectOpen(page, path);
        await expectSteadyRedBar(page);
      }

      // A page never opened: it opens and says in its place that it isn't on
      // the device — and the app keeps working (owner, 2026-10-24: "the whole
      // app basically crashed"; 2026-10-28: "Spotify style").
      await expectOpensNotOnDevice(page, menuLink(page, UNSAVED_PAGE.link), UNSAVED_PAGE.path);
      await moveTo(page, menuLink(page, "לקוחות"), "/customers");
      await expectOpen(page, "/customers");

      // A customer's page, from the saved list.
      await moveTo(
        page,
        page.getByRole("link", { name: customer.name }).filter({ visible: true }).first(),
        `/customers/${customer.id}`
      );
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
        await moveTo(page, menuLink(page, link), path);
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
