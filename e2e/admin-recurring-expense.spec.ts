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
// Every step's own onClick/onNext both updates state AND advances
// synchronously (expressAdvance()/expressGo()), with no guarantee the
// previous step's DOM has actually unmounted before the click that follows
// fires. Traced (via 3 rounds of a page.on("request")/console/pageerror +
// error-banner + dialog-text dump, see git history on this file) to two real
// failures this caused: a category click landing on a still-mounted domain
// button (silently re-picking the domain and leaving category unset, which
// made handleSubmit() bail on its own "יש להזין קטגוריה" check before ever
// reaching submitRecurring()'s fetch — invisible to a bare waitForResponse
// timeout since no request or thrown error was involved), and a textbox
// fill() landing on the still-mounted description field instead of the
// not-yet-rendered recurname field (silently saving template_name as the
// category fallback instead of the typed name). Waiting for each step's own
// title to render before interacting with it removes the race everywhere,
// not just at the two spots that happened to get caught.
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
      await expect(page.getByText("כמה עלתה ההוצאה?")).toBeVisible();
      await page.getByRole("button", { name: "3", exact: true }).click();
      await page.getByRole("button", { name: "0", exact: true }).click();
      await page.getByRole("button", { name: "0", exact: true }).click();
      await page.getByRole("button", { name: "המשך" }).click();

      // domain: שוטף (general_business) — auto-advances
      await expect(page.getByText("לאיזה תחום שייכת ההוצאה?")).toBeVisible();
      await page.getByRole("button", { name: "שוטף" }).click();

      // category: DEFAULT_EXPENSE_CATEGORY = "רכישה", an ordinary category
      // with no special submit branch. Not exact: OptionRow bakes its
      // numbered badge into the same button as a sibling text node, so the
      // accessible name is "רכישה 2", not "רכישה" alone — no other category
      // label contains "רכישה" as a substring, so a plain match stays unique.
      await expect(page.getByText("איזו קטגוריה?")).toBeVisible();
      await page.getByRole("button", { name: "רכישה" }).click();

      // description: optional free text — skip
      await expect(page.getByText("פירוט נוסף?")).toBeVisible();
      await page.getByRole("button", { name: "המשך" }).click();

      // recurname: the template's own display name — manual "המשך"
      await expect(page.getByText("איך לקרוא להוצאה הקבועה?")).toBeVisible();
      await page.getByRole("textbox").fill(templateName);
      await page.getByRole("button", { name: "המשך" }).click();

      // date: היום — auto-advances
      await expect(page.getByText("ממתי מתחיל?")).toBeVisible();
      await page.getByRole("button", { name: "היום" }).click();

      // recurfreq: first choice = "כל חודש" (monthly) — auto-advances
      await expect(page.getByText("כל כמה זמן חוזרת ההוצאה?")).toBeVisible();
      await page.locator("button[data-exp-option]").first().click();

      // recurrange (end date): optional — skip
      await expect(page.getByText("עד מתי?")).toBeVisible();
      await page.getByRole("button", { name: "המשך" }).click();

      // recurremind: first choice = "ללא" — auto-advances
      await expect(page.getByText("תזכורת חודשית לפני התשלום?")).toBeVisible();
      await page.locator("button[data-exp-option]").first().click();

      // recurvariable: first choice = "סכום קבוע" — auto-advances
      await expect(page.getByText("הסכום קבוע או משתנה?")).toBeVisible();
      await page.locator("button[data-exp-option]").first().click();

      // account: no accounts seeded → plain skip, no data-exp-option rows
      await expect(page.getByText("מאיזה חשבון?")).toBeVisible();
      await page.getByRole("button", { name: "המשך" }).click();

      // recurpay: first choice = "אישור ידני" — auto-advances
      await expect(page.getByText("איך משלמים?")).toBeVisible();
      await page.locator("button[data-exp-option]").first().click();

      // notes: optional — skip
      await expect(page.getByText("הערות פנימיות?")).toBeVisible();
      await page.getByRole("button", { name: "המשך" }).click();

      // review — final submit.
      await expect(page.getByText("הכול מוכן?")).toBeVisible();
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
