import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, getCustomerNotes } from "./db";

// The minimal, lowest-risk customer edit: CustomerNotesEditor.tsx is a
// single-field inline editor hitting only /api/customers/update {id, notes}
// — unlike EditCustomerDialog ("עריכת לקוח"), it never touches contacts/
// branches/tags, so it's the cleanest way to prove a customer edit actually
// persists.
test.describe("admin — customer edit", () => {
  test("admin can edit a customer's notes and the change persists", async ({ page }) => {
    // Flagged flaky in CI: the 15s undo-window poll below plus normal
    // page-load/interaction time can exceed the 30s default under CI's
    // slower conditions.
    test.setTimeout(60_000);
    const customer = await createTestCustomer({ name: `E2E notes customer ${Date.now()}` });
    const newNotes = `E2E note ${Date.now()}`;
    try {
      await loginAs(page, "admin");
      await page.goto(`/customers/${customer.id}`);

      await page.getByRole("button", { name: "עריכת הערות" }).click();
      await page.getByPlaceholder("הערות ללקוח...").fill(newNotes);
      await page.getByRole("button", { name: "שמירה" }).click();

      // save() goes through lib/undo-engine.ts's scheduleDeferredAction with
      // the default 10s undo window (same pattern as the attendance close
      // flow elsewhere in this suite) — the optimistic UI updates
      // immediately, but the real /api/customers/update call lands later.
      await expect.poll(() => getCustomerNotes(customer.id), { timeout: 15_000 }).toBe(newNotes);
    } finally {
      await deleteTestCustomer(customer.id);
    }
  });
});
