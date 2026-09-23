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
// domain → category is the one transition NOT taken via a blind
// `.first()`/`.nth()` on the next data-exp-option button: the domain card's
// own onClick both sets state AND calls expressAdvance() synchronously, so a
// click fired immediately after (before React/the step-change animation has
// actually swapped the DOM) can land on a domain button that's still
// mounted rather than the new category step's — 6 straight CI failures
// traced (via a page.on("request")/console/pageerror + error-banner dump,
// see git history on this file) to exactly that: the category click was
// landing on EXPENSE_BUSINESS_DOMAINS[1] ("charity"/"צדקה"), silently
// re-picking the domain and leaving category unset, which made
// handleSubmit() bail on its own "יש להזין קטגוריה" check before ever
// reaching submitRecurring()'s fetch — a client-side toast+setErrorMessage,
// not a network call or thrown error, hence invisible to a bare
// waitForResponse timeout. Waiting for the category step's own title before
// clicking, and clicking by its exact label instead of a position index,
// removes the race entirely.
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

      // category: wait for the step to actually render, then pick by label
      // (DEFAULT_EXPENSE_CATEGORY = "רכישה", an ordinary category with no
      // special submit branch) instead of a position index — see the file
      // header for why. Not exact: OptionRow bakes its numbered badge into
      // the same button as a sibling text node, so the accessible name is
      // "רכישה 2", not "רכישה" alone — no other category label contains
      // "רכישה" as a substring, so a plain substring match stays unique.
      await expect(page.getByText("איזו קטגוריה?")).toBeVisible();
      await page.getByRole("button", { name: "רכישה" }).click();

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
