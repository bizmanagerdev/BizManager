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
// "billing"/"source" never appear either. Where the exact choice doesn't
// matter (category/frequency/reminder/variable/pay-method), this clicks
// whichever data-exp-option renders FIRST rather than hardcoding a label —
// RECURRENCE_CHOICES' own first entry is "כל חודש" (monthly), which is also
// what's asserted below. The real save (POST /api/recurring-expenses/save)
// returns the new template's id directly, so no DB polling is needed.
test.describe("admin — recurring expenses", () => {
  test("admin can create a new recurring expense template", async ({ page }) => {
    test.setTimeout(90_000);
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

      // category: any — auto-advances
      await page.locator("button[data-exp-option]").first().click();

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

      // review — final submit. Three consecutive runs have timed out
      // waiting for the response, including one otherwise-healthy run (93
      // passed) — ruling out general CI load as the cause. Splitting the
      // button check from the network wait to see exactly where this
      // actually breaks: not found/not enabled (a real wizard-state bug)
      // vs. found-and-clicked-but-no-request (something else entirely).
      const reviewButton = page.getByRole("button", { name: "שמור הוצאה קבועה" });
      await expect(reviewButton, "review step's submit button never appeared").toBeVisible({ timeout: 20_000 });
      await expect(reviewButton, "review step's submit button stayed disabled").toBeEnabled({ timeout: 20_000 });
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/recurring-expenses/save") && r.request().method() === "POST", {
          timeout: 30_000,
        }),
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
