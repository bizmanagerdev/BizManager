import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";

// BackupCard (settings → "גיבוי", admin-only) had no coverage at all —
// a genuine full-system Excel export (/api/backup/export), one sheet per
// table. No data seeding needed: it exports whatever exists, and the point
// here is proving the download round-trip actually completes (a real blob,
// a real browser download), not asserting on its contents.
test.describe("admin — backup", () => {
  test("admin can download a full backup", async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page, "admin");
    await page.goto("/settings");
    await page.getByRole("button", { name: "גיבוי" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "הורד גיבוי מלא (Excel)" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^bizmanager-backup-.*\.xlsx$/);
    const path = await download.path();
    expect(path).toBeTruthy();

    await expect(page.getByText("הגיבוי הורד בהצלחה")).toBeVisible();
  });
});
