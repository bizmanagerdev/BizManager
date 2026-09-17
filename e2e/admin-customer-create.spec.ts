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

    // TEMPORARY DIAGNOSTIC, round 12 — four confirmed-real bugs fixed along
    // the way (Service Worker dev-host self-destruct, auto-recover
    // chunk-reload pair, @vercel/speed-insights redirecting to /login, the
    // hover-panel pointerdown-cancel race) measurably helped (40 -> 30 e2e
    // failures one run), but the suite still bounces 30-40 and THIS test
    // still fails — its failure point keeps MOVING rather than
    // disappearing (round 10: click "לקוח" itself; round 11: the very same
    // click SUCCEEDED, but the test still hit the overall 60s timeout
    // somewhere later, with no diagnostic — the prior instrumentation only
    // wrapped that one click). This round wraps EVERY step with a labeled
    // helper so whichever one is actually stuck next gets caught with full
    // context, instead of guessing where to look next. Also broadens the
    // DOM watch to any direct child of <body> (where Radix portals mount)
    // rather than one specific tagged button, since the failure point has
    // already moved once.
    const diag: string[] = [];
    const t0 = Date.now();
    const ts = () => `+${Date.now() - t0}ms`;
    let currentStep = "before any step";
    await page.exposeFunction("__e2ePush", (line: string) => diag.push(`${ts()} [${currentStep}] ${line}`));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) diag.push(`${ts()} [${currentStep}] [NAVIGATION] ${frame.url()}`);
    });
    page.on("pageerror", (err) => diag.push(`${ts()} [${currentStep}] [pageerror] ${err.message.slice(0, 200)}`));

    await page.evaluate(() => {
      const push = (window as unknown as { __e2ePush: (s: string) => void }).__e2ePush;
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement) push(`[BODY CHILD ADDED] <${n.tagName} class="${n.className.toString().slice(0, 60)}">`);
          });
          m.removedNodes.forEach((n) => {
            if (n instanceof HTMLElement) push(`[BODY CHILD REMOVED] <${n.tagName} class="${n.className.toString().slice(0, 60)}">`);
          });
        }
      });
      // Direct children only (not subtree) — Radix portals mount as direct
      // children of body, so this stays a clean, low-noise signal for
      // "a portal appeared/disappeared" without every internal React
      // re-render inside the app root also showing up.
      obs.observe(document.body, { childList: true });
    });

    async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
      currentStep = label;
      diag.push(`${ts()} [STEP START] ${label}`);
      try {
        const result = await fn();
        diag.push(`${ts()} [STEP OK] ${label}`);
        return result;
      } catch (err) {
        throw new Error(
          `FAILED AT STEP: "${label}"\nORIGINAL ERROR: ${(err as Error).message.slice(0, 400)}\n\n` +
            `TIMELINE (${diag.length} events, last 40 shown):\n${diag.slice(-40).join("\n")}`
        );
      }
    }

    // Short, explicit per-action timeout — round 11 showed a step can hang
    // long enough to consume the WHOLE 60s test budget with no individual
    // action ever throwing its own catchable error (Playwright's test-level
    // timeout cancels the test function outright; it doesn't reject the
    // in-flight action in a way this file's own try/catch can see). Forcing
    // each action to fail fast means whichever step is actually stuck
    // throws well within the 60s budget, landing in step()'s catch with a
    // real diagnostic dump instead of a bare "Test timeout exceeded".
    const T = 8_000;
    try {
      await loginAs(page, "admin");

      await step("open quick-create", () => page.getByRole("button", { name: "הוספה מהירה" }).click({ timeout: T }));
      await step("click לקוח tile", () => page.getByRole("button", { name: "לקוח" }).click({ timeout: T }));
      await step("fill name", () => page.getByRole("textbox").fill(customerName, { timeout: T }));
      await step("name -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));
      await step("fill phone", () =>
        page.locator('xpath=//label[contains(text(),"טלפון")]/following-sibling::input').fill("0501234567", { timeout: T })
      );
      await step("contact -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));
      await step("email -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));
      await step("pick city תל אביב", () => page.getByRole("button", { name: "תל אביב", exact: true }).click({ timeout: T }));
      await step("nameForInvoice -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));
      await step("regNumber -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));
      await step("address -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));
      await step("prepayment -> לא", () => page.getByRole("button", { name: "לא", exact: true }).click({ timeout: T }));
      await step("notes -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));
      await step("contacts -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));
      await step("branches -> continue", () => page.getByRole("button", { name: "המשך" }).click({ timeout: T }));

      const [response] = await step("submit יצירת לקוח", () =>
        Promise.all([
          page.waitForResponse((r) => r.url().includes("/api/customers/create") && r.request().method() === "POST", { timeout: T }),
          page.getByRole("button", { name: "יצירת לקוח" }).click({ timeout: T }),
        ])
      );
      const body = (await response.json()) as { customer?: { id?: string } };
      customerId = body.customer?.id ?? null;
      expect(customerId).toBeTruthy();
    } finally {
      if (customerId) await deleteTestCustomer(customerId);
    }
  });
});
