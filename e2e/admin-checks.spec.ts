import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestPayment, deleteTestPayment, getPaymentStatus } from "./db";

// /checks is a DERIVED view, not a table of its own (lib/checks.ts's
// getChecks() just queries payments WHERE payment_method='check') — there is
// no "add a check" UI anywhere; a check is always seeded by recording some
// other payment with that method. Seeded here directly via db.ts since
// there's no create flow to drive.
test.describe("admin — checks register", () => {
  test("admin can mark a pending check as cleared", async ({ page }) => {
    const checkNumber = `E2E-${Date.now()}`;
    const payment = await createTestPayment({ checkNumber, paymentStatus: "pending" });
    try {
      await loginAs(page, "admin");
      await page.goto("/checks");

      await page.getByPlaceholder("חיפוש לפי מספר צ׳ק / שם / טלפון...").fill(checkNumber);
      const row = page.locator("tr", { hasText: checkNumber });
      await expect(row).toBeVisible();

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/payments/mark-collected") && r.request().method() === "POST"),
        row.getByRole("button", { name: "סמן כנפרע" }).click(),
      ]);
      expect(response.ok()).toBe(true);

      await expect.poll(() => getPaymentStatus(payment.id)).toBe("cleared");
    } finally {
      await deleteTestPayment(payment.id);
    }
  });
});
