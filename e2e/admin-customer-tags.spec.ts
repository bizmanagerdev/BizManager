import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, getCustomerTagNames, deleteTestTagByName } from "./db";

// /customers/[id] → "עריכת לקוח" (EditCustomerButton.tsx, icon-only —
// aria-label/title carry the name, no visible text) opens EditCustomerDialog,
// whose TagPicker (kind="general", label "תגיות / סיווג לקוח") is the whole
// customer "tags/segments" feature — there's no separate segments table or
// customers.segment column (a "segment" is just a general-kind tag). The
// picker is a plain <details>/<summary> disclosure, not a Radix combobox —
// low-flake. Creating a tag (the "הוספה" button under the free-text input,
// aria-label "תגית חדשה") writes straight to `tags` via the BROWSER
// Supabase client (TagPicker.tsx's createTagDirect(), no API route) the
// instant it's clicked, separately from the dialog's own save; only the
// LINK to this customer (an entity_tags row) is written by the dialog's
// real submit, via POST /api/customers/update's tag_ids field.
test.describe("admin — customer tags", () => {
  test("admin can create and attach a tag to a customer", async ({ page }) => {
    test.setTimeout(60_000);
    const tagName = `E2E tag ${Date.now()}`;
    const customer = await createTestCustomer();
    try {
      await loginAs(page, "admin");
      await page.goto(`/customers/${customer.id}`);

      // page.tsx renders <EditCustomerButton> three times — the main "פרטי
      // לקוח" card header, plus twice more (conditionally) in the branches
      // section. A customer with zero branches shows both the main one and
      // the empty-branches shortcut simultaneously; both open the identical
      // dialog for the same customer, so .first() (the main card's, first
      // in DOM order) is a safe, correct pick regardless.
      await page.getByRole("button", { name: "עריכת לקוח" }).first().click();
      await expect(page.getByText("עריכת לקוח").last()).toBeVisible();

      await page.getByText("הוספת תגית").click();
      const newTagInput = page.getByLabel("תגית חדשה");
      await expect(newTagInput).toBeVisible();
      await newTagInput.fill(tagName);
      await page.getByRole("button", { name: "הוספה" }).click();

      // createTagDirect() is async (insert + re-render) — the removable chip
      // appearing is the real confirmation, not just the click having fired.
      await expect(page.getByRole("button", { name: "הסרה" })).toBeVisible();
      await expect(page.getByText(tagName)).toBeVisible();

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/customers/update") && r.request().method() === "POST"),
        page.getByRole("button", { name: "שמירת שינויים" }).click(),
      ]);
      expect(response.ok()).toBe(true);

      await expect.poll(() => getCustomerTagNames(customer.id)).toContain(tagName);
    } finally {
      await deleteTestTagByName(tagName);
      await deleteTestCustomer(customer.id);
    }
  });
});
