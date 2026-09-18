import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { deleteTestPayment } from "./db";

// /financial is the app's most complex page (6 entry types, cash flow engine
// — see financial-system memory) and, until now, had only nav-smoke.spec.ts's
// "doesn't crash" check — no test actually recorded a real entry through the
// UI. IncomeDialog (components/financial/IncomeDialog.tsx) is a dynamic
// step-wizard mirroring ExpenseDialog's own "express" pattern: domain and
// method cards auto-advance (pickDomain/pickMethod both call advanceTo),
// only the free-input steps (amount, notes, etc.) need a manual "המשך".
// general_business (domain: "שוטף") is the cheapest path — no project/order/
// property linking step — and with 0 accounts seeded locally, method="cash"
// skips the "account" step entirely (IncomeDialog.tsx: `if (accountsList.
// length > 0) ids.push("account")`, unlike ExpenseDialog's own account step,
// which always appears once paid/partial regardless of whether any accounts
// exist — confirmed by reading both, not assumed the two dialogs match).
test.describe("admin — income recording", () => {
  test("admin can record a one-time cash income and it shows on /financial", async ({ page }) => {
    test.setTimeout(60_000);
    let paymentId: string | null = null;
    try {
      await loginAs(page, "admin");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      await page.getByRole("button", { name: "הכנסה" }).click();

      // domain: "שוטף" (general_business) — auto-advances straight to amount
      // (no project/order/property picker for this domain).
      await page.getByRole("button", { name: "שוטף" }).click();

      // amount: a free-input CurrencyInput — renders as a plain text input
      // (CurrencyInput.tsx explicitly drops type="number" whenever it's
      // grouping thousands, which it is here since value is controlled), not
      // role=spinbutton. Needs the manual nav button.
      await page.getByRole("textbox").fill("380");
      await page.getByRole("button", { name: "המשך" }).click();

      // method: cash — auto-advances to "date" directly (0 accounts seeded
      // locally, so the "account" step never gets pushed onto the wizard's
      // own step list at all).
      await page.getByRole("button", { name: "מזומן" }).click();

      // date: leave at its default (today), just advance.
      await page.getByRole("button", { name: "המשך" }).click();
      // dueDate ("תאריך פירעון צפוי?", optional for a non-check method) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();
      // reference (optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();

      // vat: "לא" — auto-advances to notes.
      await page.getByRole("button", { name: "לא", exact: true }).click();

      // notes (optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();
      // tags (general_business only, optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();
      // attachments (optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();

      // review — final submit.
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/payments/create") && r.request().method() === "POST"),
        page.getByRole("button", { name: "שמירת הכנסה" }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { payment?: { id?: string; amount_total?: number } };
      paymentId = body.payment?.id ?? null;
      expect(paymentId).toBeTruthy();
      expect(body.payment?.amount_total).toBe(380);

      await page.goto("/financial");
      // /financial keeps both the "היסטוריה" and "יומן מלא" tab panels
      // mounted at once (see admin-expenses.spec.ts's own comment on this),
      // so filter to the visible copy.
      const row = page.locator(`tr[data-focus-id="payment:${paymentId}"]:visible`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("380");
    } finally {
      if (paymentId) await deleteTestPayment(paymentId);
    }
  });
});
