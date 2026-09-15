import { chromium, type Locator } from "@playwright/test";
import { E2E_USERS } from "./fixtures";

/**
 * Next dev mode compiles a route or a dynamic-import chunk ON DEMAND, the
 * FIRST time anything actually requests it. QuickCreateDialogs (the "+"
 * menu's `dynamic(() => import(...))` bundle) statically imports nearly
 * every dialog in the app in one shot — the order/project/expense wizards,
 * CreateCustomerDialog, IncomeDialog, AccountTransferDialog,
 * CollectPaymentDialog, ReminderFormDialog, AttendanceLogDialog,
 * WorkerPaymentDialog, SessionEditorDialog. TaskUpsertDialog and
 * ExpenseDialog are each ALSO their own separate `dynamic()` chunk nested
 * inside that bundle, so opening the outer panel alone doesn't compile them
 * — only actually opening THOSE specific tiles does.
 *
 * The FIRST test to open one of these triggers a live compile, and once it
 * finishes, an HMR update remounts the affected tree — right in the middle
 * of whatever interaction triggered it (confirmed directly via a real CI
 * run's captured console output: "[Fast Refresh] rebuilding" firing right
 * before a quick-create tile click starts failing with "element was
 * detached from the DOM, retrying" — see the admin-customer-create.spec.ts
 * diagnostic that caught this).
 *
 * An earlier version of this warmup opened the panel and just waited a flat
 * 3s — not long enough: this bundle is large, and on a CI runner (slower and
 * more contended than a dev machine) it can still be compiling well past
 * that, so the real completion happened later, mid-test. This version
 * instead opens each of the three tiles that need their own compile and
 * waits for that DIALOG'S OWN CONTENT to actually render — the only real
 * signal that its chunk has finished compiling — rather than guessing a
 * duration.
 *
 * This is a dev-server-only artifact — production ships pre-built, with no
 * on-demand compilation at all — so the fix belongs in the test harness,
 * once, rather than padding every test that happens to touch a lazy-loaded
 * chunk. The same dev server process serves every test in the run, so this
 * one-time cost benefits all of them.
 *
 * CI SKIPS ALL OF THIS ENTIRELY: after four separate attempts at patching
 * around dev-mode instability kept hitting the same wall (see
 * playwright.config.ts's webServer comment for the full account), CI was
 * switched to serve an already-built app instead of `next dev` — which has
 * none of the on-demand compilation this warmup exists to work around, so
 * running it there would just be pure wasted time on every run. Still runs
 * for local `npm run test:e2e`, which stays on `next dev` for fast iteration.
 */
export default async function globalSetup() {
  if (process.env.CI) return;
  const baseURL = "http://127.0.0.1:3000";
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/login`);
    await page.locator('input[type="email"]').fill(E2E_USERS.admin.email);
    await page.locator('input[type="password"]').fill(E2E_USERS.admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await page.waitForURL("**/dashboard");

    // Each tile below forces a real compile-and-render round trip, waiting
    // on a locator specific to that dialog's own first-step content — not a
    // fixed timeout — so this only moves on once the chunk has genuinely
    // finished. Best-effort per tile: one slow/broken dialog shouldn't stop
    // the rest of the suite from warming up (globalSetup throwing would
    // abort the entire run, which is worse than an incomplete warmup).
    const tiles: { tile: string; readySelector: () => Locator }[] = [
      { tile: "לקוח", readySelector: () => page.getByRole("textbox").first() },
      { tile: "הוצאה", readySelector: () => page.getByRole("button", { name: "2", exact: true }) },
      { tile: "משימה", readySelector: () => page.getByPlaceholder("שם המשימה") },
    ];
    for (const { tile, readySelector } of tiles) {
      try {
        await page.getByRole("button", { name: "הוספה מהירה" }).click();
        await page.getByRole("button", { name: tile, exact: true }).click();
        await readySelector().waitFor({ state: "visible", timeout: 30_000 });
      } catch {
        // Best-effort warmup — a real test hitting this tile later will just
        // pay the compile cost itself instead of failing here.
      }
      // Fresh navigation rather than relying on Escape/close-button behavior
      // to reset for the next tile — each dialog may have its own
      // discard-confirmation guard or close mechanics, and a stuck dialog
      // here would silently skip warming everything after it. The dev
      // server's already-compiled chunks aren't affected by a client-side
      // reload.
      await page.goto(`${baseURL}/dashboard`).catch(() => {});
    }

    // Separately-routed pages this suite also exercises, each compiled on
    // its own first visit, independent of the quick-create bundle above.
    // /tasks (dnd-kit + a 1700+-line client component) and /calendar (its
    // own gesture/pinch/swipe machinery) are particularly heavy first
    // compiles.
    for (const path of ["/financial/loans", "/sales/orders/new", "/properties", "/tasks", "/calendar", "/collections", "/settings"]) {
      await page.goto(`${baseURL}${path}`).catch(() => {});
      await page.waitForTimeout(1_500);
    }
  } finally {
    await browser.close();
  }
}
