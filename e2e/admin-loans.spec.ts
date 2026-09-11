import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestCustomer,
  deleteTestCustomer,
  createTestLoan,
  deleteTestLoan,
  getLoanRepaymentTotal,
  getLoanIdByLender,
} from "./db";

// Everything on /financial/loans (create, repay, mark installment paid) is a
// Next.js Server Action, not a /api/* route (app/(app)/financial/loans/
// actions.ts) — no network response to wait on, so these tests poll the DB
// directly, same pattern as the ProjectStatusPicker test elsewhere in this
// suite (also a direct-write, no-route case).
test.describe("admin — loans", () => {
  test("admin can create a loan through the dialog", async ({ page }) => {
    test.setTimeout(60_000);
    const lenderCustomer = await createTestCustomer({ name: `E2E lender ${Date.now()}` });
    let loanId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/financial/loans");

      await page.getByRole("button", { name: "הלוואה חדשה" }).click();
      await page.getByRole("button", { name: "הלוואה שלקחתי" }).click();

      await page.getByPlaceholder("חיפוש לקוח...").fill(lenderCustomer.name);
      await page.getByRole("button", { name: lenderCustomer.name, exact: true }).click();

      await page
        .locator('xpath=//label[contains(text(),"תאריך הלוואה")]/following-sibling::input')
        .fill("2026-01-01");
      await page
        .locator('xpath=//label[contains(text(),"סכום ההלוואה")]/following-sibling::input')
        .fill("5000");

      await page.getByRole("button", { name: "הוספה" }).click();

      await expect.poll(() => getLoanIdByLender(lenderCustomer.name)).not.toBeNull();
      loanId = await getLoanIdByLender(lenderCustomer.name);
    } finally {
      if (loanId) await deleteTestLoan(loanId);
      await deleteTestCustomer(lenderCustomer.id);
    }
  });

  test("admin can record a loan repayment", async ({ page }) => {
    const loan = await createTestLoan({ amount: 5000 });
    try {
      await loginAs(page, "admin");
      await page.goto("/financial/loans");

      // /financial/loans lists every loan — scope to this test's own card by
      // its unique (Date.now()-suffixed) lender name.
      const card = page.locator("[data-focus-id]", { hasText: loan.lender });
      await card.getByRole("button", { name: "החזרים" }).click();

      await page.getByRole("button", { name: "רישום החזר" }).click();
      await page
        .locator('xpath=//label[contains(text(),"סכום")]/following-sibling::input')
        .first()
        .fill("1000");
      await page.getByRole("button", { name: "הוסף החזר" }).click();

      await expect.poll(() => getLoanRepaymentTotal(loan.id)).toBe(1000);
    } finally {
      await deleteTestLoan(loan.id);
    }
  });
});
