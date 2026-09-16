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

    // TEMPORARY DIAGNOSTIC, round 10 — the hover-panel pointerdown-cancel fix
    // (components/ui/hover-panel.tsx) measurably helped (40 -> 30 e2e
    // failures across the whole suite), but THIS test still fails, now with
    // a subtly different signature: Playwright confirms the tile visible/
    // stable/scrolled-into-view successfully, and ONLY THEN it detaches —
    // later in the sequence than before. Hypothesis: Playwright waits out
    // the panel's own entrance animation (stability check) BEFORE ever
    // moving the mouse, so the 180ms hideSoon timer — started only once the
    // mouse actually leaves the trigger — can still fully elapse before
    // pointerdown is ever dispatched, meaning the cancel() fix never gets a
    // chance to run before the removal already happened. This round
    // confirms that directly: logs exactly when cancel() fires (if at all)
    // relative to the removal.
    const diag: string[] = [];
    const t0 = Date.now();
    const ts = () => `+${Date.now() - t0}ms`;
    await page.exposeFunction("__e2ePush", (line: string) => diag.push(`${ts()} ${line}`));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) diag.push(`${ts()} [NAVIGATION] ${frame.url()}`);
    });
    page.on("pageerror", (err) => diag.push(`${ts()} [pageerror] ${err.message.slice(0, 200)}`));

    try {
      await loginAs(page, "admin");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();

      await page.evaluate(() => {
        const push = (window as unknown as { __e2ePush: (s: string) => void }).__e2ePush;

        // Patch setTimeout/clearTimeout globally, just for the duration of
        // this window, to see exactly when the hover panel's own hideSoon
        // timer gets scheduled, cancelled, or fires — without needing to
        // touch the component's source.
        const origSetTimeout = window.setTimeout;
        const origClearTimeout = window.clearTimeout;
        const tracked = new Map<number, number>();
        (window as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
          const id = origSetTimeout(
            (...cbArgs: unknown[]) => {
              if (delay === 180) push(`[TIMER FIRED] id had delay=180`);
              if (typeof fn === "function") (fn as (...a: unknown[]) => void)(...cbArgs);
            },
            delay,
            ...args
          );
          if (delay === 180) {
            tracked.set(id as unknown as number, delay);
            push(`[TIMER SCHEDULED] delay=180 id=${id}`);
          }
          return id;
        }) as typeof setTimeout;
        (window as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((id?: number) => {
          if (id !== undefined && tracked.has(id)) push(`[TIMER CLEARED] id=${id}`);
          return origClearTimeout(id);
        }) as typeof clearTimeout;

        window.addEventListener("pointerdown", () => push("[pointerdown on window, capture]"), true);

        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("לקוח"));
        if (!btn) {
          push("[TAG] button not found at tag time");
          return;
        }
        btn.setAttribute("data-e2e-watch", "1");
        push("[TAG] tagged OK");
        const obs = new MutationObserver((mutations) => {
          for (const m of mutations) {
            m.removedNodes.forEach((n) => {
              if (!(n instanceof HTMLElement)) return;
              const isTarget = n.getAttribute("data-e2e-watch") === "1" || n.querySelector('[data-e2e-watch="1"]');
              if (isTarget) push(`[REMOVED] <${n.tagName} class="${n.className.toString().slice(0, 60)}">`);
            });
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      });

      try {
        await page.getByRole("button", { name: "לקוח" }).click();
      } catch (err) {
        throw new Error(
          `ORIGINAL ERROR: ${(err as Error).message.slice(0, 500)}\n\n` +
            `TIMELINE (${diag.length} events, last 30 shown):\n${diag.slice(-30).join("\n") || "none"}`
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
