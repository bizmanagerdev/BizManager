import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loginAs } from "./fixtures";
import {
  createTestCustomer,
  deleteTestCustomer,
  createTestOrder,
  deleteTestOrder,
  createTestOrderItem,
  getOrderStatus,
} from "./db";

// TEMPORARY DIAGNOSTIC — writes straight to a file instead of relying on
// Playwright's `github` reporter, whose annotations kept either getting
// crowded out by other failing specs or showing an unrelated raw postgres
// error instead of this test's own thrown message. A CI step reads this
// file directly and emits it as a `::error::` workflow command, which is
// unaffected by any of that.
const DIAG_FILE = path.join(__dirname, "DIAG_OUTPUT.txt");
function diagLog(line: string) {
  fs.appendFileSync(DIAG_FILE, line + "\n---\n");
}

// Real admin/office money flows through orders — the biggest gap in E2E
// coverage before this file: every existing spec only confirms pages don't
// crash, none actually creates or mutates financial data through the UI.
test.describe("admin — order creation and payment collection", () => {
  test("admin can create an order through the wizard with a free-text line item", async ({ page }) => {
    // More steps than the 30s default comfortably covers in CI - and a
    // timed-out test skips the rest of its finally block's async cleanup,
    // which is exactly how a failed run once left stray "E2E ..." customers
    // behind for an unrelated test (login.spec.ts) to trip over.
    test.setTimeout(60_000);
    const customer = await createTestCustomer({ name: `E2E order customer ${Date.now()}` });
    let orderId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/sales/orders/new");

      await page.getByRole("button", { name: "לקוח קיים" }).click();
      await page.locator('[aria-label="חיפוש לקוח"]').fill(customer.name);
      await page.getByText(customer.name, { exact: true }).first().click();
      await page.getByRole("button", { name: "המשך" }).click();

      // Items step: a free-text line avoids needing a seeded product/catalog
      // fixture chain. addCustomLine() (NewOrderClient.tsx:630) starts it at
      // unit_price: 0 — the price field is behind the "פרטים נוספים" details
      // toggle, same row.
      await page.getByRole("button", { name: "שורה חופשית" }).click();
      await page.getByPlaceholder("שם השורה (למשל: משלוח)").fill("שורת בדיקה E2E");
      // A real DOM click, not Playwright's own hit-tested .click() — this
      // <summary> sits inside a nested overflow-y-auto region whose height
      // depends on an `absolute inset-0` sibling-height-matching trick
      // (NewOrderClient.tsx's own comment: "fills its grid cell so its
      // height matches the product picker"), which can still be settling
      // right after adding a line — CI showed 27+ retries of "element ...
      // intercepts pointer events" without ever resolving. <details>/
      // <summary> is a native disclosure widget, so a direct element.click()
      // triggers the exact same real toggle (and any attached React
      // handler, since React's delegated listeners still catch a real DOM
      // click) without depending on Playwright's own scroll+hit-test
      // sequence succeeding in this specific nested-scroll layout.
      await page.getByText("פרטים נוספים").evaluate((el) => (el as HTMLElement).click());
      await page.getByPlaceholder("מחיר").fill("500");

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/orders/create") && r.request().method() === "POST"),
        (async () => {
          // Walk forward through every remaining default-satisfied step
          // (branch/invoice/collection/paymentTerms/payments/dates/notes/
          // summary) until the final submit button appears.
          for (let i = 0; i < 12; i++) {
            const createButton = page.getByRole("button", { name: "יצירת הזמנה" });
            if (await createButton.isVisible().catch(() => false)) {
              await createButton.click();
              return;
            }
            await page.getByRole("button", { name: "המשך" }).click();
          }
          throw new Error("Never reached the order-creation summary step");
        })(),
      ]);
      const body = (await response.json()) as { order_id?: string };
      orderId = body.order_id ?? null;
      expect(orderId).toBeTruthy();

      await page.waitForURL("**/sales");

      const order = await getOrderStatus(orderId as string);
      expect(order.total_amount).toBe(500);
    } finally {
      if (orderId) await deleteTestOrder(orderId);
      await deleteTestCustomer(customer.id);
    }
  });

  test("admin can collect a full payment on an existing order", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E full-pay customer ${Date.now()}` });
    const order = await createTestOrder(customer.id);
    await createTestOrderItem(order.id, { unitPrice: 1000, quantityOrdered: 1 });
    try {
      await loginAs(page, "admin");
      await page.goto(`/sales/orders/${order.id}`);

      await page.getByRole("button", { name: "עדכון תשלום" }).click();
      await page.getByPlaceholder("0.00").fill("1000");
      // NativeSelect renders a bare native <select> (no wrapper, no aria-label
      // — the label is an unassociated sibling <label>, same pattern as every
      // other form in this app), so selectOption by visible option text is
      // the correct interaction — NOT click-to-open, that's for a custom
      // combobox, which this isn't.
      await page
        .locator('xpath=//label[text()="אמצעי תשלום *"]/following-sibling::select')
        .selectOption({ label: "מזומן" });

      // TEMPORARY DIAGNOSTIC — see DIAG_FILE comment above.
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/orders/payments/create")),
        page.getByRole("button", { name: "שמירת תשלום" }).click(),
      ]);
      const reqBody = response.request().postData();
      const resBody = await response.json().catch(() => null);
      diagLog(
        `[full-payment] status=${response.status()} ok=${response.ok()} orderId=${order.id}\nREQUEST: ${reqBody}\nRESPONSE: ${JSON.stringify(resBody)}`
      );
      if (!response.ok()) {
        throw new Error(`PAYMENT CREATE FAILED — status=${response.status()}, see DIAG_OUTPUT.txt`);
      }

      await expect.poll(async () => (await getOrderStatus(order.id)).payment_status).toBe("paid");
    } finally {
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
    }
  });

  test("admin can collect a partial payment on an existing order", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E partial-pay customer ${Date.now()}` });
    const order = await createTestOrder(customer.id);
    await createTestOrderItem(order.id, { unitPrice: 1000, quantityOrdered: 1 });
    try {
      await loginAs(page, "admin");
      await page.goto(`/sales/orders/${order.id}`);

      await page.getByRole("button", { name: "עדכון תשלום" }).click();
      await page.getByPlaceholder("0.00").fill("400");
      await page
        .locator('xpath=//label[text()="אמצעי תשלום *"]/following-sibling::select')
        .selectOption({ label: "מזומן" });

      // TEMPORARY DIAGNOSTIC — see DIAG_FILE comment above.
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/orders/payments/create")),
        page.getByRole("button", { name: "שמירת תשלום" }).click(),
      ]);
      const reqBody = response.request().postData();
      const resBody = await response.json().catch(() => null);
      diagLog(
        `[partial-payment] status=${response.status()} ok=${response.ok()} orderId=${order.id}\nREQUEST: ${reqBody}\nRESPONSE: ${JSON.stringify(resBody)}`
      );
      if (!response.ok()) {
        throw new Error(`PAYMENT CREATE FAILED — status=${response.status()}, see DIAG_OUTPUT.txt`);
      }

      await expect.poll(async () => (await getOrderStatus(order.id)).payment_status).toBe("partial");
    } finally {
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
    }
  });
});
