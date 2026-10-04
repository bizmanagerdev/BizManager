import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestAccount,
  deleteTestAccount,
  createTestPayment,
  deleteTestPayment,
  getPaymentStatus,
} from "./db";

// /checks is a DERIVED view, not a table of its own (lib/checks.ts's
// getChecks() just queries payments WHERE payment_method='check') — there is
// no "add a check" UI anywhere; a check is always seeded by recording some
// other payment with that method. Seeded here directly via db.ts since
// there's no create flow to drive.
//
// The row's "סמן כנפרע" only OPENS a "הפקדת צ׳ק" dialog asking which account
// the check was deposited into (ChecksClient.tsx's requestSetCleared); the
// save to /api/payments/mark-collected fires from that dialog's own
// "סמן כנפרע" submit. The dialog pre-fills the check's own account and
// refuses to save with none picked whenever any accounts exist — so the
// check is seeded with its own account, independent of whatever accounts
// other tests have left in the database.
test.describe("admin — checks register", () => {
  test("admin can mark a pending check as cleared", async ({ page }) => {
    const checkNumber = `E2E-${Date.now()}`;
    const account = await createTestAccount({ name: `E2E checks account ${Date.now()}` });
    const payment = await createTestPayment({ checkNumber, paymentStatus: "pending", accountId: account.id });
    try {
      await loginAs(page, "admin");
      await page.goto("/checks");

      await page.getByPlaceholder("חיפוש לפי מספר צ׳ק / שם / טלפון...").fill(checkNumber);
      const row = page.locator("tr", { hasText: checkNumber });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "סמן כנפרע" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("הפקדת צ׳ק")).toBeVisible();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/payments/mark-collected") && r.request().method() === "POST"),
        dialog.getByRole("button", { name: "סמן כנפרע" }).click(),
      ]);
      expect(response.ok()).toBe(true);

      await expect.poll(() => getPaymentStatus(payment.id)).toBe("cleared");
    } finally {
      await deleteTestPayment(payment.id);
      await deleteTestAccount(account.id);
    }
  });
});
