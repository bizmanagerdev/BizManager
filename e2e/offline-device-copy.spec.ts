import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, deleteTestTaskByTitle, findTaskIdBySubject } from "./db";
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

// The app with no connection on a device whose copy of the data (PowerSync)
// syncs — the office's phones and computers. The device pages come from the
// server as frames the device fills in from its copy; the service worker keeps
// the frames (public/sw.js FRAMES_CACHE), and the app itself asks for the
// menu's frames and its whole code once the copy is ready (OfflineMenuFrames).
// A task added with no connection waits on the device and goes up when the
// connection is back (lib/powersync/connector.ts).
//
// Runs in the "offline-copy" project (playwright.config.ts) — only in CI, on a
// build that syncs with a PowerSync server CI runs on the test database
// (.github/workflows/ci.yml, "Start a PowerSync server on the test database").
// A device whose copy isn't ready is offline-pages.spec.ts.

test.skip(!process.env.E2E_POWERSYNC, "needs CI's PowerSync server and the build that syncs with it");

const server = serverSwitch();
test.beforeAll(() => server.start());
test.afterEach(() => server.set(true));
test.afterAll(() => server.stop());

/** Menu pages opened online — device pages, saved as frames as they're opened. */
const OPENED_PAGES = [
  { link: "דשבורד", path: "/dashboard" },
  { link: "משימות", path: "/tasks" },
  { link: "פרויקטים", path: "/projects" },
  { link: "מכירות", path: "/sales" },
  { link: "לקוחות", path: "/customers" },
];
/** Menu pages never opened: the app saves their frames itself (lib/powersync/device-frames.ts menuFramePaths). */
const NEVER_OPENED = ["/properties", "/rent"];

/** The account menu's line on the device's copy (components/powersync/LocalSyncStatusLine). */
async function expectCopySynced(page: Page) {
  // Opens on hover, and stays open while the pointer is there.
  await page.locator("#topbar-user-trigger").hover();
  await expect(
    page.getByRole("status").filter({ hasText: "נתונים במכשיר" }),
    "the device's copy never finished syncing with CI's PowerSync server"
  ).toContainText("מעודכן", { timeout: 120_000 });
  await page.mouse.move(0, 0);
}

/** Drawn from the device's copy: the page is a device page's frame (components/powersync/DeviceFrameMark). */
async function expectDevicePage(page: Page) {
  await expect(page.locator("[data-device-page]")).toBeAttached();
}

test.describe("offline, with the device's copy syncing", () => {
  test.describe.configure({ timeout: 360_000 });

  test("the device pages open from the copy, a task added offline waits and goes up", async ({ page, context }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(`${page.url()} — ${error.message}`));
    const customer = await createTestCustomer();
    const subject = `E2E offline task ${Date.now()}`;
    try {
      // ── Online: sign in, let the copy sync, open the menu's pages ──
      await context.addInitScript(watchRedBar);
      await loginAs(page, "admin");
      expect(
        await page.evaluate(() => window.isSecureContext),
        "the browser doesn't treat the .test address as secure (playwright.config.ts, project \"offline-copy\")"
      ).toBe(true);
      await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 30_000 });
      await expectCopySynced(page);

      const opened = [...OPENED_PAGES.map(({ path }) => path), `/customers/${customer.id}`];
      for (const path of opened) {
        await page.goto(path);
        await expectOpen(page, path);
        await expectDevicePage(page);
      }
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();

      // What the app saves by itself once the copy is ready: the menu's frames
      // (opened or not) and the whole app's code — no shortcut from the test.
      await page.goto("/dashboard");
      await expect
        .poll(() => savedAddresses(page, "frames"), { message: "device pages' frames saved", timeout: 60_000, intervals: [2000] })
        .toEqual(expect.arrayContaining([...opened, ...NEVER_OPENED]));
      const build = await workerBuild(page);
      await expect
        .poll(() => appCodeSaved(page, build), { message: "the whole app's code saved", timeout: 120_000, intervals: [2000] })
        .toBe(true);

      // ── No connection: the device says so, and nothing answers ──
      await context.setOffline(true);
      server.set(false);
      await expectSteadyRedBar(page);

      // Moving between the device pages: each opens — inside the page when the
      // app holds it already, else from its saved frame — drawn from the copy.
      for (const { link, path } of [...OPENED_PAGES.slice(1), OPENED_PAGES[0]]) {
        await moveTo(page, menuLink(page, link), path);
        await expectOpen(page, path);
        await expectDevicePage(page);
        await expectSteadyRedBar(page);
      }

      // A page with no device version, never opened: it opens and says so in
      // its place, and the app moves on from it.
      await expectOpensNotOnDevice(page, menuLink(page, "יומן"), "/calendar");

      // The customers list from the copy, and a customer's page from it.
      await moveTo(page, menuLink(page, "לקוחות"), "/customers");
      await moveTo(
        page,
        page.getByRole("link", { name: customer.name }).filter({ visible: true }).first(),
        `/customers/${customer.id}`
      );
      await expectOpen(page, `/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
      await expectSteadyRedBar(page);

      // "+" → task, saved with no connection: it waits on the device, and the
      // red bar counts it and lists it (owner, 2026-10-11: a task added in
      // airplane mode went up when the signal came back). Added here, on a page
      // drawn from the copy — so the copy is open: a save in the first moment
      // after a page loads whole, before it opens, takes the older offline
      // queue instead (TaskUpsertDialog), sent the same way but not on the
      // board until then.
      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      await page.getByRole("button", { name: "משימה", exact: true }).click();
      await page.getByPlaceholder("שם המשימה").fill(subject);
      await page.getByRole("button", { name: "יצירה" }).click();
      await expect(page.getByPlaceholder("שם המשימה")).toBeHidden();
      await expectNotBroken(page);
      const waiting = page.getByText(/^אין חיבור — \d+ פעולות נשמרו ויישלחו כשיחזור החיבור$/);
      await expect(waiting).toBeVisible();
      // The bar's own "פרטים" — the innermost box holding both.
      await page
        .locator("div")
        .filter({ has: waiting })
        .filter({ has: page.getByRole("button", { name: "פרטים" }) })
        .last()
        .getByRole("button", { name: "פרטים" })
        .click();
      const list = page.getByRole("dialog");
      await expect(list.getByText(`משימה: ${subject}`), "not among the device's saves").toBeVisible();
      await page.keyboard.press("Escape");

      // On the board, from the copy — and still there after a refresh with no connection.
      await moveTo(page, menuLink(page, "משימות"), "/tasks");
      await expectOpen(page, "/tasks");
      await expect(page.getByText(subject)).toBeVisible();
      await page.reload();
      await expectOpen(page, "/tasks");
      await expectDevicePage(page);
      await expect(page.getByText(subject)).toBeVisible();
      await expectSteadyRedBar(page);
      expect(await findTaskIdBySubject(subject), "the task reached the server with no connection").toBeNull();

      // Pages never opened online: their frames were saved by the app.
      for (const path of NEVER_OPENED) {
        await page.goto(path);
        await expectOpen(page, path);
        await expectDevicePage(page);
        await expectSteadyRedBar(page);
      }
      await page.goto("/tasks");
      await expectOpen(page, "/tasks");
      await expect(page.getByText(subject)).toBeVisible();

      // ── Back online: the bar goes, and the task goes up by itself ──
      server.set(true);
      await context.setOffline(false);
      await expect(page.getByText(RED_BAR).filter({ visible: true })).toHaveCount(0, { timeout: 30_000 });
      await expect
        .poll(() => findTaskIdBySubject(subject), { message: "the task sent once the connection was back", timeout: 60_000 })
        .not.toBeNull();
      await expect(page.getByText(/פעולות ממתינות לשליחה/)).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText(subject)).toBeVisible();
    } finally {
      if (pageErrors.length > 0) test.info().annotations.push({ type: "page errors", description: pageErrors.join("\n") });
      await deleteTestTaskByTitle(subject);
      await deleteTestCustomer(customer.id);
    }
  });
});
