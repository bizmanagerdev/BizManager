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

    // TEMPORARY DIAGNOSTIC, round 8 — three confirmed-real, verified bugs
    // fixed in a row (Service Worker dev-host self-destruct, auto-recover
    // chunk-reload pair, @vercel/speed-insights redirecting to /login) with
    // ZERO effect on this test's "element was detached from the DOM"
    // failure each time. Rounds 1-7's diagnostics never directly checked the
    // single most basic question: is the page actually NAVIGATING at all
    // when this happens? This round adds a real `framenavigated` listener
    // (catches both full reloads and SPA route changes) plus a
    // MutationObserver tagging the exact "לקוח" button node and reporting
    // the precise moment/context it gets removed from the DOM — instead of
    // continuing to infer the mechanism from correlated network/console
    // noise.
    const diag: string[] = [];
    const t0 = Date.now();
    const ts = () => `+${Date.now() - t0}ms`;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) diag.push(`${ts()} [NAVIGATION] ${frame.url()}`);
    });
    page.on("console", (msg) => {
      if (msg.text().includes("realtime/v1/websocket")) return;
      diag.push(`${ts()} [console:${msg.type()}] ${msg.text().slice(0, 200)}`);
    });
    page.on("pageerror", (err) => diag.push(`${ts()} [pageerror] ${err.message.slice(0, 200)}`));

    try {
      await loginAs(page, "admin");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();

      // Tag the exact node so a MutationObserver can report precisely when
      // (and what ancestor) removes it, rather than inferring cause from
      // correlated timing.
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("לקוח"));
        const log: string[] = [];
        (window as unknown as { __mutationLog: string[] }).__mutationLog = log;
        if (!btn) {
          log.push("BUTTON NOT FOUND AT TAG TIME");
          return;
        }
        btn.setAttribute("data-e2e-watch", "1");
        const start = performance.now();
        const obs = new MutationObserver((mutations) => {
          for (const m of mutations) {
            m.removedNodes.forEach((n) => {
              if (!(n instanceof HTMLElement)) return;
              const isTarget = n.getAttribute("data-e2e-watch") === "1" || n.querySelector('[data-e2e-watch="1"]');
              if (isTarget) {
                log.push(
                  `+${(performance.now() - start).toFixed(0)}ms REMOVED <${n.tagName} class="${n.className.toString().slice(0, 80)}"> ` +
                    `readyState=${document.readyState} title="${document.title}"`
                );
              }
            });
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      });

      try {
        await page.getByRole("button", { name: "לקוח" }).click();
      } catch (err) {
        const mutationLog = await page
          .evaluate(() => (window as unknown as { __mutationLog?: string[] }).__mutationLog ?? [])
          .catch(() => ["<could not read mutation log — page likely navigated away>"]);
        throw new Error(
          `ORIGINAL ERROR: ${(err as Error).message.slice(0, 500)}\n\n` +
            `MUTATIONS (${mutationLog.length}):\n${mutationLog.slice(0, 20).join("\n") || "none"}\n\n` +
            `TIMELINE (${diag.length} events, last 25 shown):\n${diag.slice(-25).join("\n") || "none"}`
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
