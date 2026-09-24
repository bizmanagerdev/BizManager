import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestCustomer,
  deleteTestCustomer,
  createTestProject,
  deleteTestProject,
  createTestTag,
  linkCustomerTag,
  deleteTestTagByName,
} from "./db";

// /financial/reports (admin-only) → TabsTrigger "לקוחות" renders
// CustomerRankingPanel, fed by lib/financial/customerRanking.ts's
// loadCustomerRanking() — server-fetched (CashFlowPageContent.tsx awaits it
// before render), no client-side loading race. Ranking/filtering both
// happen client-side over the SAME rows: tagFilter narrows report.rows
// FIRST, then "top" (totalSales > 0) and "inactive" (no lastActivityAt, or
// older than inactiveCutoff) are computed from that narrowed set — so
// filtering by a tag only one customer has trivially puts that customer in
// whichever table it qualifies for, regardless of its rank among everyone
// else. A customer needs orders/projects/sales to even appear at all
// (customerRanking.ts's didBusiness check) — a bare createTestProject()
// satisfies that with zero sales, which lands the customer in "לקוחות
// שנרדמו" (inactive: lastActivityAt stays null with no order/payment) not
// "לקוחות מובילים" (top requires totalSales > 0) — this test checks the
// inactive table specifically, matching that.
test.describe("admin — customer ranking report tag filter", () => {
  test("filtering by a segment tag surfaces the tagged customer", async ({ page }) => {
    test.setTimeout(60_000);
    const tagName = `E2E segment ${Date.now()}`;
    const customer = await createTestCustomer();
    const project = await createTestProject(customer.id);
    const tag = await createTestTag(tagName);
    await linkCustomerTag(customer.id, tag.id);
    try {
      await loginAs(page, "admin");
      await page.goto("/financial/reports");

      await page.getByRole("tab", { name: "לקוחות" }).click();

      const filterPill = page.getByRole("button", { name: tagName });
      await expect(filterPill).toBeVisible({ timeout: 15_000 });
      await filterPill.click();

      await expect(page.getByRole("link", { name: customer.name })).toBeVisible();
    } finally {
      await deleteTestTagByName(tagName);
      await deleteTestProject(project.id);
      await deleteTestCustomer(customer.id);
    }
  });
});
