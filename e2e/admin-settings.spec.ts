import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { getVatRate, setVatRate } from "./db";

// vat_rate lives on business_settings, a SINGLETON row shared by the whole
// app (see lib/settings/vat.ts) — not a row this test can scope to itself,
// so the original value must be restored in `finally` regardless of outcome.
//
// VatRateCard commits through scheduleDeferredAction (undo-engine): the UI
// updates optimistically, and the real POST /api/settings/vat only fires
// after the ~10s default undo window — hence expect.poll with a >10s timeout
// rather than an immediate DB check.
test.describe("admin — settings", () => {
  test("admin can change the VAT rate", async ({ page }) => {
    const initialRate = await getVatRate();
    const initialPercent = Math.round(initialRate * 10000) / 100;
    const nextPercent = initialPercent >= 50 ? initialPercent - 1 : initialPercent + 1;
    try {
      await loginAs(page, "admin");
      await page.goto("/settings");
      await page.getByRole("button", { name: "כספים" }).click();

      const vatInput = page.locator(
        'xpath=//label[contains(text(),"שיעור (%)")]/following-sibling::div//input'
      );
      await expect(vatInput).toBeVisible();
      await vatInput.fill(String(nextPercent));
      // The finance tab has several cards (VAT rate, books start date, CC fee
      // rate...), each with its own "שמירה" submit button — scope to the
      // <form> that actually contains the VAT input, not the whole tab.
      const vatForm = page.locator("form", { has: vatInput });
      await vatForm.getByRole("button", { name: "שמירה" }).click();

      await expect.poll(() => getVatRate(), { timeout: 15_000 }).toBeCloseTo(nextPercent / 100, 4);
    } finally {
      await setVatRate(initialRate);
    }
  });
});
