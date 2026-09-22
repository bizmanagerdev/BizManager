import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, getCustomerBranchByName } from "./db";

// customer_branches (a customer ordering for several of its own locations,
// e.g. a chain) had no E2E coverage — only a read-only render on the
// customer detail page (page.tsx's activeBranches list) was ever exercised
// indirectly by other tests. EditCustomerDialog.tsx (opened via the
// "עריכת לקוח" pencil — NOT CustomerForm.tsx, a differently-wired sibling
// component used elsewhere) inlines its own branches section, always
// visible (no <details> toggle, unlike CustomerForm's own copy). Only the
// branch name is required — address/phone are skipped here since "כתובת"
// also labels the customer's own top-level address field earlier in the
// same dialog, which would make a label-text lookup ambiguous. Unlike
// VatRateCard's scheduleDeferredAction, EditCustomerDialog's save() writes
// for real (POST /api/customer-branches/create) before onOpenChange(false)
// closes the dialog and registerReversibleAction only registers the undo
// option after — so waiting for the dialog to close is enough to know the
// write landed.
test.describe("admin — customer branches", () => {
  test("admin can add a branch to a customer", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E branch customer ${Date.now()}` });
    const branchName = `E2E branch ${Date.now()}`;
    try {
      await loginAs(page, "admin");
      await page.goto(`/customers/${customer.id}`);

      // EditCustomerButton mounts three times on this page (header, and both
      // branches states) — all open the same dialog, so .first() is enough.
      await page.getByRole("button", { name: "עריכת לקוח" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      await dialog.getByRole("button", { name: "הוספת סניף" }).click();
      await dialog.locator('xpath=//label[contains(text(),"שם הסניף")]/following::input[1]').fill(branchName);

      await dialog.getByRole("button", { name: "שמירת שינויים" }).click();
      await expect(dialog).toBeHidden();

      await expect.poll(() => getCustomerBranchByName(customer.id, branchName)).not.toBeNull();
      await expect(page.getByText(branchName)).toBeVisible();
    } finally {
      await deleteTestCustomer(customer.id);
    }
  });
});
