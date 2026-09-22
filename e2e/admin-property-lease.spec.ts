import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestCustomer,
  deleteTestCustomer,
  createTestProperty,
  deleteTestProperty,
  getLeaseAgreementByProperty,
  deleteTestLeaseAgreement,
} from "./db";

// PropertyDetailClient's "שכירות" (leases) card had no E2E coverage —
// createLease is a Server Action (app/(app)/properties/actions.ts), not an
// /api/* route, so this polls the DB rather than waiting on a network
// response (same pattern as admin-properties.spec.ts's own property-create
// test). CustomerPicker here is a plain <Input> + absolute results list
// backed by the same cached fuzzy search index as global search — NOT a
// Radix Popper-family control, so no flakiness concern there.
test.describe("admin — property leases", () => {
  test("admin can add a lease (tenant) to a property", async ({ page }) => {
    test.setTimeout(60_000);
    const customer = await createTestCustomer({ name: `E2E tenant ${Date.now()}` });
    const property = await createTestProperty({ address: `E2E leased property ${Date.now()}` });
    let leaseId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto(`/properties/${property.id}`);

      await page.getByRole("button", { name: "חוזה חדש" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      await dialog.getByPlaceholder("חיפוש לקוח...").fill(customer.name);
      await dialog.getByRole("button", { name: new RegExp(customer.name) }).click();

      const today = new Date();
      const dd = String(today.getDate()).padStart(2, "0");
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const yyyy = today.getFullYear();
      await dialog.getByPlaceholder("dd/mm/yy").first().fill(`${dd}/${mm}/${yyyy}`);

      const rentInput = dialog.locator('xpath=//div[contains(text(),"מחיר חודשי")]/following-sibling::div//input');
      await rentInput.fill("3000");

      await dialog.getByRole("button", { name: "הוספה" }).click();

      await expect.poll(() => getLeaseAgreementByProperty(property.id)).not.toBeNull();
      const lease = await getLeaseAgreementByProperty(property.id);
      leaseId = lease?.id ?? null;
      expect(lease?.customer_id).toBe(customer.id);
      expect(lease?.monthly_rent_amount).toBe(3000);

      await expect(page.getByText(customer.name)).toBeVisible();
    } finally {
      if (leaseId) await deleteTestLeaseAgreement(leaseId);
      await deleteTestProperty(property.id);
      await deleteTestCustomer(customer.id);
    }
  });
});
