import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { getRecurringExpenseTemplate, deleteTestRecurringExpenseTemplate } from "./db";

// The payments calendar's "קבועות" tab (RecurringExpensesManager) had no
// coverage at all — creating a new recurring bill via "הוצאה קבועה חדשה"
// opens ExpenseDialog with defaultRecurring, which SKIPS the "recurrence"
// (one-time vs recurring) step entirely and starts isRecurring=true (see
// ExpenseDialog.tsx's own comment: "a NEW expense opened with
// defaultRecurring starts on the recurring path"). Every expCard-based
// option (domain/category/frequency/reminder/variable/pay-method) carries
// data-exp-option and auto-advances on click; free-text steps
// (description/recurname/notes) need an explicit "המשך". showAttachments
// defaults false here (PaymentsHubClient never passes it), so there's no
// "files" step, and showBillingOptions/needsSourcePicker are both false for
// a plain general_business template (no project/order/property), so
// "billing"/"source" never appear either. The real save (POST
// /api/recurring-expenses/save) returns the new template's id directly, so
// no DB polling is needed.
//
// category is picked via .nth(1), NOT .first(): categoryOptions puts
// WORKER_WAGE_CATEGORY first whenever workerSupport is true (admin/office
// always can), and picking it flips isWorkerPayment true, which sends
// handleSubmit down submitWorkerSession() instead of submitRecurring() —
// the actual cause of this test failing 4 straight times waiting on a save
// response that, with that category picked, was never going to arrive at
// this URL at all. Every OTHER data-exp-option step below genuinely doesn't
// care which choice wins, so .first() stays fine there.
test.describe("admin — recurring expenses", () => {
  test("admin can create a new recurring expense template", async ({ page }) => {
    test.setTimeout(60_000);
    const templateName = `E2E recurring ${Date.now()}`;
    let templateId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/financial/payments-calendar?tab=recurring");

      await page.getByRole("button", { name: "הוצאה קבועה חדשה" }).click();

      // amount: 300
      await page.getByRole("button", { name: "3", exact: true }).click();
      await page.getByRole("button", { name: "0", exact: true }).click();
      await page.getByRole("button", { name: "0", exact: true }).click();
      await page.getByRole("button", { name: "המשך" }).click();

      // domain: שוטף (general_business) — auto-advances
      await page.getByRole("button", { name: "שוטף" }).click();

      // category: .nth(1) — see the file header for why NOT .first().
      await page.locator("button[data-exp-option]").nth(1).click();

      // description: optional free text — skip
      await page.getByRole("button", { name: "המשך" }).click();

      // recurname: the template's own display name — manual "המשך"
      await page.getByRole("textbox").fill(templateName);
      await page.getByRole("button", { name: "המשך" }).click();

      // date: היום — auto-advances
      await page.getByRole("button", { name: "היום" }).click();

      // recurfreq: first choice = "כל חודש" (monthly) — auto-advances
      await page.locator("button[data-exp-option]").first().click();

      // recurrange (end date): optional — skip
      await page.getByRole("button", { name: "המשך" }).click();

      // recurremind: first choice = "ללא" — auto-advances
      await page.locator("button[data-exp-option]").first().click();

      // recurvariable: first choice = "סכום קבוע" — auto-advances
      await page.locator("button[data-exp-option]").first().click();

      // account: no accounts seeded → plain skip, no data-exp-option rows
      await page.getByRole("button", { name: "המשך" }).click();

      // recurpay: first choice = "אישור ידני" — auto-advances
      await page.locator("button[data-exp-option]").first().click();

      // notes: optional — skip
      await page.getByRole("button", { name: "המשך" }).click();

      // review — final submit.
      const reviewButton = page.getByRole("button", { name: "שמור הוצאה קבועה" });
      await expect(reviewButton).toBeVisible();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/recurring-expenses/save") && r.request().method() === "POST"),
        reviewButton.click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { id?: string };
      templateId = body.id ?? null;
      expect(templateId).toBeTruthy();

      const template = await getRecurringExpenseTemplate(templateId!);
      expect(template?.template_name).toBe(templateName);
      expect(template?.frequency).toBe("monthly");
      expect(template?.is_active).toBe(true);

      await expect(page.getByText(templateName)).toBeVisible();
    } finally {
      if (templateId) await deleteTestRecurringExpenseTemplate(templateId);
    }
  });
});
