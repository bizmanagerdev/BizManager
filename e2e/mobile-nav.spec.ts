import { test, expect } from "@playwright/test";
import { loginAs, loginWithCredentials } from "./fixtures";
import { createTestWorker, deleteTestWorker } from "./db";

// Phone navigation (runs in the "mobile" Playwright project — a Pixel profile,
// see playwright.config.ts). On a phone the sidebar is replaced by the
// bottom bar (components/layout/BottomNav.tsx): a few fixed tabs, the + in
// the centre, and "עוד" — a bottom sheet holding everything else, derived
// from the sidebar (components/layout/nav-items.tsx). Admin's bar is
// דשבורד / פרויקטים / מכירות; a worker's is the first three of his own nav.
//
// "עוד" renders a ClientOnly fallback button before hydration that does
// nothing when tapped, so opening the sheet is retried until it shows.
async function openMoreSheet(page: import("@playwright/test").Page) {
  const nav = page.locator("nav[data-bottom-nav]");
  const sheet = page.getByRole("dialog").filter({ hasText: "עוד" });
  await expect(async () => {
    await nav.getByRole("button", { name: "עוד" }).tap();
    await expect(sheet).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return sheet;
}

test.describe("mobile — navigation", () => {
  test("admin's bottom bar shows its tabs and a tab navigates", async ({ page }) => {
    await loginAs(page, "admin");

    const nav = page.locator("nav[data-bottom-nav]");
    await expect(nav).toBeVisible();
    for (const tab of ["דשבורד", "פרויקטים", "מכירות"]) {
      await expect(nav.getByRole("link", { name: tab })).toBeVisible();
    }

    await nav.getByRole("link", { name: "פרויקטים" }).tap();
    await page.waitForURL("**/projects");
  });

  test("admin can reach a page through the עוד sheet", async ({ page }) => {
    await loginAs(page, "admin");

    const sheet = await openMoreSheet(page);
    await sheet.getByRole("link", { name: "לקוחות" }).tap();
    await page.waitForURL("**/customers");
    await expect(sheet).toBeHidden();
  });

  test("a worker's bottom bar and עוד sheet hold only worker pages", async ({ page }) => {
    const worker = await createTestWorker();
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      const nav = page.locator("nav[data-bottom-nav]");
      for (const tab of ["דשבורד", "משלוחים", "משימות"]) {
        await expect(nav.getByRole("link", { name: tab })).toBeVisible();
      }
      await expect(nav.getByRole("link", { name: "פרויקטים" })).toHaveCount(0);

      const sheet = await openMoreSheet(page);
      await expect(sheet.getByRole("link", { name: "יומן" })).toBeVisible();
      await expect(sheet.getByRole("link", { name: "תזרים" })).toHaveCount(0);
      await expect(sheet.getByRole("link", { name: "לקוחות" })).toHaveCount(0);
    } finally {
      await deleteTestWorker(worker);
    }
  });
});
