import { chromium } from "@playwright/test";
import { E2E_USERS } from "./fixtures";

/**
 * Next.js dev mode compiles a route or a dynamic-import chunk ON DEMAND, the
 * FIRST time anything actually requests it. QuickCreateDialogs (the "+"
 * menu's `dynamic(() => import(...))` bundle) statically imports nearly
 * every dialog in the app in one shot — the order/project/expense wizards,
 * CreateCustomerDialog, IncomeDialog, AccountTransferDialog,
 * CollectPaymentDialog, ReminderFormDialog, AttendanceLogDialog,
 * WorkerPaymentDialog, SessionEditorDialog. The FIRST e2e test to open the
 * quick-create panel triggers a live compile of that whole bundle, and once
 * it finishes, Next's Fast Refresh pushes an HMR update that remounts the
 * affected tree — right in the middle of whatever interaction triggered it.
 *
 * Confirmed directly via a real CI run's captured console output: "[Fast
 * Refresh] rebuilding" fires at the exact moment a quick-create tile click
 * starts failing with "element was detached from the DOM, retrying" (see
 * the admin-customer-create.spec.ts diagnostic that caught this).
 *
 * This is a dev-server-only artifact — production ships pre-built, with no
 * on-demand compilation or Fast Refresh at all — so the fix belongs in the
 * test harness, once, rather than padding every test that happens to touch
 * a lazy-loaded chunk. Warming these chunks up here, before the real suite
 * starts, means the dev server has already compiled and cached them by the
 * time any real test needs them; the same dev server process serves every
 * test in the run, so this one-time cost benefits all of them.
 */
export default async function globalSetup() {
  const baseURL = "http://127.0.0.1:3000";
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/login`);
    await page.locator('input[type="email"]').fill(E2E_USERS.admin.email);
    await page.locator('input[type="password"]').fill(E2E_USERS.admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await page.waitForURL("**/dashboard");

    // Triggers QuickCreateDialogs' prefetch() -> the one big dynamic import
    // behind every wizard/dialog it bundles.
    await page.getByRole("button", { name: "הוספה מהירה" }).click().catch(() => {});
    await page.waitForTimeout(3_000);

    // Separately-routed dialogs/pages this suite also exercises, each
    // compiled on its own first visit, independent of the quick-create
    // bundle above. /tasks (dnd-kit + a 1700+-line client component) and
    // /calendar (its own gesture/pinch/swipe machinery) are particularly
    // heavy first compiles.
    for (const path of ["/financial/loans", "/sales/orders/new", "/properties", "/tasks", "/calendar", "/collections", "/settings"]) {
      await page.goto(`${baseURL}${path}`).catch(() => {});
      await page.waitForTimeout(1_500);
    }
  } finally {
    await browser.close();
  }
}
