import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestProperty, deleteTestProperty } from "./db";

// PropertiesCard ("נכסים") is explicitly pure display — its own comment says
// "no one-click action lives on this card" — so the only thing worth proving
// is navigation. getPropertiesSummary (lib/properties.ts) treats any active
// property with zero active lease_agreements rows as vacant; createTestProperty
// makes neither a lease nor a name, so it's vacant by construction and its
// row label falls back to its address.
test.describe("admin — dashboard properties card", () => {
  test("clicking a vacant property row opens its detail page", async ({ page }) => {
    const property = await createTestProperty({ address: `E2E vacant property ${Date.now()}` });
    try {
      await loginAs(page, "admin");

      const row = page.getByRole("link", { name: property.address, exact: true });
      await expect(row).toBeVisible();
      await row.click();

      await page.waitForURL(`**/properties/${property.id}`);
    } finally {
      await deleteTestProperty(property.id);
    }
  });
});
