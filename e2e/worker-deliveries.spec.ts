import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import {
  createTestWorker,
  deleteTestWorker,
  createTestCustomer,
  deleteTestCustomer,
  createTestOrder,
  deleteTestOrder,
  createTestOrderItem,
  getOrderStatus,
} from "./db";

// Delivery confirmation + payment (app/(app)/sales/orders/OrderConfirmDialog.tsx,
// opened from /deliveries as "סמן כסופק") is the highest-risk worker flow in
// the app — two real RLS bugs were fixed in it within the last two days
// (20260908202057 + 20260909200005, see foundation-hardening memory) and a
// third, client-side bug (the review step showing "שולם" for a check payment
// that actually saves as pending) was fixed this session.
//
// Split deliberately: the actual payment/status OUTCOME is tested at the API
// level (page.request, sharing the logged-in worker's session) for
// reliability — /api/orders/update accepts plain JSON as well as the
// multipart form the wizard itself sends (see the route's own content-type
// branch), so this exercises the exact same server logic without depending
// on getting every wizard step's locator right. One additional UI-level test
// specifically targets the check-payment display bug, since that bug is IN
// the client's own computation and an API test can't see it.
test.describe("worker role scoping — delivery confirmation & payment", () => {
  test("a worker can confirm delivery with a full cash payment", async ({ page }) => {
    const worker = await createTestWorker();
    const customer = await createTestCustomer();
    const order = await createTestOrder(customer.id);
    const item = await createTestOrderItem(order.id, { quantityOrdered: 1, unitPrice: 100 });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      const response = await page.request.post("/api/orders/update", {
        data: {
          order_id: order.id,
          customer_id: customer.id,
          order_date: new Date().toISOString(),
          status: "delivered",
          discount_amount: 0,
          items: [
            {
              product_id: null,
              description: "פריט בדיקה",
              quantity_ordered: 1,
              quantity_delivered: 1,
              unit_price: 100,
              discount_amount: 0,
            },
          ],
          payments: [{ amount_total: 100, payment_date: new Date().toISOString().slice(0, 10), payment_method: "cash" }],
        },
      });
      expect(response.ok()).toBe(true);

      const final = await getOrderStatus(order.id);
      expect(final.status).toBe("delivered");
      expect(final.payment_status).toBe("paid");
    } finally {
      void item;
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
      await deleteTestWorker(worker);
    }
  });

  test("a worker can record a partial payment on delivery confirmation", async ({ page }) => {
    const worker = await createTestWorker();
    const customer = await createTestCustomer();
    const order = await createTestOrder(customer.id);
    const item = await createTestOrderItem(order.id, { quantityOrdered: 1, unitPrice: 100 });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      // Fully DELIVERED (all quantity handed over) but only HALF paid — status
      // and payment_status are independent axes (finalStatus is qty-derived,
      // payment_status is amount-derived), so this is genuinely "delivered +
      // partial", not "partially delivered".
      const response = await page.request.post("/api/orders/update", {
        data: {
          order_id: order.id,
          customer_id: customer.id,
          order_date: new Date().toISOString(),
          status: "delivered",
          discount_amount: 0,
          items: [
            {
              product_id: null,
              description: "פריט בדיקה",
              quantity_ordered: 1,
              quantity_delivered: 1,
              unit_price: 100,
              discount_amount: 0,
            },
          ],
          payments: [{ amount_total: 50, payment_date: new Date().toISOString().slice(0, 10), payment_method: "cash" }],
        },
      });
      expect(response.ok()).toBe(true);

      const final = await getOrderStatus(order.id);
      expect(final.status).toBe("delivered");
      expect(final.payment_status).toBe("partial");
    } finally {
      void item;
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
      await deleteTestWorker(worker);
    }
  });

  test("a full-amount check payment does not mark the order paid (still pending)", async ({ page }) => {
    const worker = await createTestWorker();
    const customer = await createTestCustomer();
    const order = await createTestOrder(customer.id);
    const item = await createTestOrderItem(order.id, { quantityOrdered: 1, unitPrice: 100 });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      const response = await page.request.post("/api/orders/update", {
        data: {
          order_id: order.id,
          customer_id: customer.id,
          order_date: new Date().toISOString(),
          status: "delivered",
          discount_amount: 0,
          items: [
            {
              product_id: null,
              description: "פריט בדיקה",
              quantity_ordered: 1,
              quantity_delivered: 1,
              unit_price: 100,
              discount_amount: 0,
            },
          ],
          payments: [{ amount_total: 100, payment_date: new Date().toISOString().slice(0, 10), payment_method: "check" }],
        },
      });
      expect(response.ok()).toBe(true);

      // lib/payments.ts's defaultPaymentStatusForMethod always starts a check
      // as 'pending', excluded from the server's own collected-amount
      // derivation — so a check for the FULL amount still leaves the order
      // unpaid until the check actually clears.
      const final = await getOrderStatus(order.id);
      expect(final.payment_status).not.toBe("paid");
    } finally {
      void item;
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
      await deleteTestWorker(worker);
    }
  });

  // Regression test for the client-side display bug fixed this session: the
  // review step used to compute its shown "סטטוס תשלום" purely from the
  // entered amount, ignoring that a check payment never counts as collected
  // — so it could say "שולם" for an order that would actually save as
  // unpaid/partial. This walks the real wizard (not an API call) since the
  // bug is in the CLIENT's own display logic.
  test("the confirm wizard's review step never shows a check payment as paid", async ({ page }) => {
    const worker = await createTestWorker();
    const customer = await createTestCustomer();
    const order = await createTestOrder(customer.id);
    const item = await createTestOrderItem(order.id, { quantityOrdered: 1, unitPrice: 100 });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await page.goto("/deliveries");

      const row = page.locator("tr", { hasText: customer.name });
      await row.getByRole("button", { name: "סמן כסופק" }).click();

      // items step already defaults every line to "delivered now" = fully owed.
      await page.getByRole("button", { name: "הבא" }).click();
      // paidChoice
      await page.getByRole("button", { name: "כן, נגבה תשלום" }).click();
      // amount — "הכל" fills the full outstanding amount without touching the keypad.
      await page.getByRole("button", { name: "הכל" }).click();
      await page.getByRole("button", { name: "הבא" }).click();
      // paymentDate — defaults to today already.
      await page.getByRole("button", { name: "הבא" }).click();
      // paymentMethod
      await page.getByRole("combobox").selectOption({ label: "צ'ק" });
      await page.getByRole("button", { name: "הבא" }).click();
      // reference (optional), paymentNotes (optional) — skip through.
      await page.getByRole("button", { name: "הבא" }).click();
      await page.getByRole("button", { name: "הבא" }).click();
      // deliveryDate — defaults to today already.
      await page.getByRole("button", { name: "הבא" }).click();
      // images (optional)
      await page.getByRole("button", { name: "הבא" }).click();
      // comments (optional)
      await page.getByRole("button", { name: "הבא" }).click();
      // arrival (optional)
      await page.getByRole("button", { name: "הבא" }).click();

      // review — the actual assertion.
      await expect(page.getByText("סטטוס תשלום")).toBeVisible();
      await expect(page.getByText("שולם", { exact: true })).toHaveCount(0);
    } finally {
      void item;
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
      await deleteTestWorker(worker);
    }
  });

  test("a worker can save a customer's delivery/arrival instructions", async ({ page }) => {
    const worker = await createTestWorker();
    const customer = await createTestCustomer();
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      const instructions = `E2E arrival note ${Date.now()}`;
      const response = await page.request.post("/api/customers/delivery-location", {
        data: { customer_id: customer.id, instructions, lat: 32.08, lng: 34.78 },
      });
      expect(response.ok()).toBe(true);

      const read = await page.request.get(`/api/customers/delivery-location?customer_id=${customer.id}`);
      expect(read.ok()).toBe(true);
      const body = (await read.json()) as { instructions?: string | null; lat?: number | null };
      expect(body.instructions).toBe(instructions);
      expect(body.lat).toBe(32.08);
    } finally {
      await deleteTestCustomer(customer.id);
      await deleteTestWorker(worker);
    }
  });

  test("a worker without deliveries access is rejected by the delivery confirmation API", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { deliveries: false } });
    const customer = await createTestCustomer();
    const order = await createTestOrder(customer.id);
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForLoadState("domcontentloaded");

      const response = await page.request.post("/api/orders/update", {
        data: {
          order_id: order.id,
          customer_id: customer.id,
          order_date: new Date().toISOString(),
          status: "delivered",
          discount_amount: 0,
          items: [
            { product_id: null, description: "פריט בדיקה", quantity_ordered: 1, quantity_delivered: 1, unit_price: 100, discount_amount: 0 },
          ],
          payments: [],
        },
      });
      expect(response.status()).toBe(403);
    } finally {
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
      await deleteTestWorker(worker);
    }
  });
});
