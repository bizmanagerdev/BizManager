import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";

// DomainChartCard ("הכנסות והוצאות") is the one dashboard widget with no row-
// level action at all — its only interactive control is the month picker,
// which round-trips to loadDomainChartMonth (a server action, re-checking the
// viewer's role) rather than re-deriving anything client-side. That round
// trip — not the recharts rendering itself, which is a heavy, lazily-loaded
// dependency not worth asserting on pixel-by-pixel — is what's worth proving:
// switching months must not error, and the picker must land on the month it
// was asked for. No seeded data needed: even the empty "אין תנועת מזומן"
// state is a legitimate result of a working round trip.
test.describe("admin — dashboard domain chart card", () => {
  test("switching the chart's month picker loads without error", async ({ page }) => {
    await loginAs(page, "admin");

    const select = page.getByRole("combobox", { name: "בחירת חודש" });
    await expect(select).toBeVisible();

    const options = await select.locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(1);
    const currentValue = await select.inputValue();
    const otherOption = await select.locator("option").nth(1);
    const otherValue = await otherOption.getAttribute("value");
    expect(otherValue).not.toBe(currentValue);

    await select.selectOption(otherValue!);

    // pickMonth sets the select's value OPTIMISTICALLY before the round trip
    // even starts, then disables it for the duration (disabled={pending}) — a
    // failed round trip reverts the value once it resolves. Waiting for the
    // select to re-enable, THEN checking its value, is what actually proves
    // the round trip succeeded rather than catching the optimistic moment
    // before a later revert.
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue(otherValue!);
  });
});
