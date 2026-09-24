import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestCardStatement,
  createTestCardStatementRow,
  getCardStatementRowExpenseId,
  getExpensePaymentStatus,
  deleteTestExpense,
  deleteTestCardStatement,
} from "./db";

// /financial/statements/[id] ("יצירת הוצאות" flow). The XLSX/PDF upload +
// parse wizard (app/(app)/financial/import/CardImportClient.tsx) already has
// thorough unit coverage (__tests__/lib/financial/cardImport.test.ts —
// parseAmount/parseDateToIso/findDuplicate/detectHeaderRow, incl. the
// header-row-divider regression), so this test targets the one thing units
// can't cover: the statement DETAIL page's own review/confirm step, which
// materializes staged card_statement_rows into real expenses via POST
// /api/expenses/statement-rows/create-expenses. Seeding card_statements +
// card_statement_rows directly (this route's page.tsx does a plain SSR
// fetch, no client-side data-loading race to work around) sidesteps the
// parser entirely — include defaults to true at the DB level
// (baseline.sql), and a business_domain set at seed time already satisfies
// eligibleRows' filter (StatementDetailClient.tsx: !expenseExists &&
// !expenseId && include && isExpenseBusinessDomain(businessDomain) &&
// amount > 0), so the seeded row is eligible for "צור הוצאות" with no row-
// level UI interaction needed — just the two confirm clicks.
test.describe("admin — CC statement import", () => {
  test("admin can create an expense from a staged statement row", async ({ page }) => {
    test.setTimeout(60_000);
    const amount = 220;
    const description = `E2E merchant ${Date.now()}`;
    const statement = await createTestCardStatement();
    const row = await createTestCardStatementRow(statement.id, { amount, description });
    let expenseId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto(`/financial/statements/${statement.id}`);

      // "יצירת הוצאות (N)" (opens the confirm dialog) vs. the dialog's own
      // "צור הוצאות (N)" (the real submit) — distinct Hebrew phrases
      // ("creation of" vs "create"), no substring overlap.
      const openDialogButton = page.getByRole("button", { name: "יצירת הוצאות" });
      await expect(openDialogButton).toBeVisible({ timeout: 15_000 });
      await openDialogButton.click();

      await expect(page.getByText("יצירת הוצאות").last()).toBeVisible();
      const createButton = page.getByRole("button", { name: "צור הוצאות" });
      await expect(createButton).toBeVisible();
      await expect(createButton).toBeEnabled();
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/expenses/statement-rows/create-expenses") && r.request().method() === "POST"
        ),
        createButton.click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { created?: number };
      expect(body.created).toBe(1);

      await expect.poll(() => getCardStatementRowExpenseId(row.id)).not.toBeNull();
      expenseId = await getCardStatementRowExpenseId(row.id);
      expect(await getExpensePaymentStatus(expenseId!)).toBe("paid");
    } finally {
      if (expenseId) await deleteTestExpense(expenseId);
      await deleteTestCardStatement(statement.id);
    }
  });
});
