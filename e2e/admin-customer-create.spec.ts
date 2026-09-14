import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { deleteTestCustomer } from "./db";

// CreateCustomerDialog (quick-create "לקוח" tile) is a much bigger wizard
// than project memory suggested (13 possible steps, not "4") — name, contact
// (phone, required), email, city (required), cityOther, nameForInvoice,
// regNumber, address, prepayment, notes, contacts, branches, summary. Only
// name/phone/city are actually required; everything else defaults through.
//
// Uses StepWizardDialog with nextLabel left undefined for every intermediate
// step, so the button falls back to step-wizard.tsx's own default —
// "המשך ל{next step}" on desktop, not a fixed "הבא" (a real mistake this
// suite already made once for NewOrderClient's identical pattern, and fixed
// the same way here up front: match by "המשך" as a substring, not the exact
// dynamic label).
test.describe("admin — customer creation", () => {
  test("admin can create a customer through the full wizard", async ({ page }) => {
    // See admin-orders.spec.ts's order-creation test for why: more wizard
    // steps than the 30s default comfortably covers, and a timed-out test
    // skips the rest of its finally block's cleanup.
    test.setTimeout(60_000);
    const customerName = `E2E new customer ${Date.now()}`;
    let customerId: string | null = null;

    // TEMPORARY DIAGNOSTIC — this test has failed identically ("element was
    // detached from the DOM, retrying" on the same "לקוח" tile click) across
    // three different fix attempts (global-setup warmup, auto-reload
    // production-only guard, onDemandEntries tuning), with zero change in the
    // failure. That reproducibility with no reaction to any fix means further
    // fixes would be guessing — this captures real console/network evidence
    // from the CI browser via the thrown error's own message (readable
    // through the Checks annotations API even without log/artifact access).
    // Remove once root-caused.
    const diag: string[] = [];
    page.on("console", (msg) => diag.push(`[console:${msg.type()}] ${msg.text().slice(0, 300)}`));
    page.on("pageerror", (err) => diag.push(`[pageerror] ${err.message.slice(0, 300)}`));
    page.on("requestfailed", (req) => diag.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`));

    try {
      await loginAs(page, "admin");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      try {
        await page.getByRole("button", { name: "לקוח" }).click();
      } catch (err) {
        throw new Error(
          `DIAGNOSTIC dump (${diag.length} events, last 50 shown):\n` +
            diag.slice(-50).join("\n") +
            `\n\nORIGINAL ERROR: ${(err as Error).message}`
        );
      }

      // name
      await page.getByRole("textbox").fill(customerName);
      await page.getByRole("button", { name: "המשך" }).click();

      // contact — phone is the required field on this step.
      await page
        .locator('xpath=//label[contains(text(),"טלפון")]/following-sibling::input')
        .fill("0501234567");
      await page.getByRole("button", { name: "המשך" }).click();

      // email (optional) — skip.
      await page.getByRole("button", { name: "המשך" }).click();

      // city (required) — OptionRow auto-advances past cityOther straight to
      // nameForInvoice.
      await page.getByRole("button", { name: "תל אביב", exact: true }).click();

      // Remaining optional steps (nameForInvoice/regNumber/address) then
      // prepayment (auto-advances on click) then notes/contacts/branches —
      // walk forward to the summary step's final submit button.
      await page.getByRole("button", { name: "המשך" }).click(); // nameForInvoice
      await page.getByRole("button", { name: "המשך" }).click(); // regNumber
      await page.getByRole("button", { name: "המשך" }).click(); // address
      await page.getByRole("button", { name: "לא", exact: true }).click(); // prepayment
      await page.getByRole("button", { name: "המשך" }).click(); // notes
      await page.getByRole("button", { name: "המשך" }).click(); // contacts
      await page.getByRole("button", { name: "המשך" }).click(); // branches

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/customers/create") && r.request().method() === "POST"),
        page.getByRole("button", { name: "יצירת לקוח" }).click(),
      ]);
      const body = (await response.json()) as { customer?: { id?: string } };
      customerId = body.customer?.id ?? null;
      expect(customerId).toBeTruthy();
    } finally {
      if (customerId) await deleteTestCustomer(customerId);
    }
  });
});
