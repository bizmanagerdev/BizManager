import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestAccount, deleteTestAccount, getAccountTransferAmount } from "./db";

// AccountTransferDialog (components/financial/AccountTransferDialog.tsx) is
// NOT an income or expense — it writes a single account_transfers row that
// the accounts ledger reads as one OUT leg + one IN leg, and the P&L/cash-
// flow report must not see it at all (its own top comment). It requires at
// least 2 active accounts before it'll even open past a "not enough
// accounts" message — this local e2e stack never has any seeded, so this
// test seeds exactly one bank + one cash account itself.
//
// With exactly one of each kind, applyMode's onlyId() auto-fills BOTH sides
// the moment "משיכה" (withdraw, bank->cash) is picked, and
// firstStepAfterMode skips "from"/"to" entirely since neither candidate
// list has more than one option — landing straight on "amount". Confirmed
// by reading applyMode/firstStepAfterMode, not assumed to shortcut the
// same way IncomeDialog's own account step does.
test.describe("admin — account transfers", () => {
  test("admin can record a withdrawal from bank to cash", async ({ page }) => {
    test.setTimeout(60_000);
    const bank = await createTestAccount({ name: `E2E bank ${Date.now()}`, kind: "bank" });
    const cash = await createTestAccount({ name: `E2E cash ${Date.now()}`, kind: "cash" });
    try {
      await loginAs(page, "admin");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      await page.getByRole("button", { name: "העברה בין חשבונות" }).click();

      // mode: "משיכה" (withdraw) — auto-fills both accounts and jumps
      // straight to "amount" (see file comment above).
      await page.getByRole("button", { name: "משיכה" }).click();

      await page.getByRole("textbox").fill("500");
      await page.getByRole("button", { name: "המשך" }).click();

      // date: leave at its default (today), just advance.
      await page.getByRole("button", { name: "המשך" }).click();
      // notes (optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();

      // review — final submit. saveAccountTransfer (lib/financial/
      // transfersClient.ts) is a direct browser -> Supabase call, not an
      // API route — no response to wait on. Not deferred either
      // (registerReversibleCreate only registers the undo AFTER the real
      // write already resolved, same pattern as AccountsCard's own create
      // path), so the dialog closing + the success toast is already the
      // real signal.
      await page.getByRole("button", { name: "שמירה" }).click();
      await expect(page.getByText("המשיכה נרשמה.")).toBeVisible();

      // Real proof, not just the toast — read the row back.
      await expect.poll(() => getAccountTransferAmount(bank.id, cash.id)).toBe(500);
    } finally {
      await deleteTestAccount(bank.id);
      await deleteTestAccount(cash.id);
    }
  });
});
