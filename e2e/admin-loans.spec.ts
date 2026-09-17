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
      // Not exact: true — CustomerPicker's result button renders the phone
      // in a sibling span inside the SAME button (createTestCustomer always
      // sets one), so the real accessible name is "name\nphone", never
      // exactly equal to the bare name alone.
      await page.getByRole("button", { name: lenderCustomer.name }).click();

      await page
        .locator('xpath=//label[contains(text(),"תאריך הלוואה")]/following-sibling::input')
        .fill("2026-01-01");
      // סכום ההלוואה is a CurrencyInput, which wraps its <input> in its own
      // container div (for the ₪ marker span) — see the repayment amount
      // field's identical fix below for the same reason.
      await page
        .locator('xpath=//label[contains(text(),"סכום ההלוואה")]/following-sibling::div//input')
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
      // CurrencyInput wraps its <input> in its own container div (for the ₪
      // marker span) — it's a following-sibling's DESCENDANT, not a direct
      // following-sibling of the <label>, so a bare "following-sibling::input"
      // never matches anything here.
      await page
        .locator('xpath=//label[contains(text(),"סכום")]/following-sibling::div//input')
        .first()
        .fill("1000");
      await page.getByRole("button", { name: "הוסף החזר" }).click();

      await expect.poll(() => getLoanRepaymentTotal(loan.id)).toBe(1000);
    } finally {
      await deleteTestLoan(loan.id);
    }
  });
});
