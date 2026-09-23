import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestWorker,
  deleteTestWorker,
  createTestAttendanceSession,
  deleteTestAttendanceSession,
  getSessionDebtStatus,
  deleteTestWorkerPayment,
  type TestWorker,
} from "./db";

// /payroll/workers/[id] ("כספים" tab, default for an admin — see
// SalaryCenterClient.tsx's <Tabs defaultValue={canManageSalary ? "finances"
// : ...}>) → "הוספת תשלום" opens a FormDialog that both records a
// worker_payments row AND allocates it against open debt items
// (worker_debt_items_view). A worker created via createTestWorker() with no
// payrollWorkerType override gets pay_tracking_mode='session' (the users
// table's own DB default, left untouched by that helper) — so a directly
// seeded attendance_sessions row with labor_cost > 0 shows up as a payable
// debt item immediately, no payroll period/payslip machinery or date gating
// involved (getPayableDebtAmount only special-cases payslip items). No
// account is seeded on purpose: AccountSelect renders nothing at all with
// zero accounts, and account_id is only required client-side when the list
// is non-empty (workerPaymentAccountsList.length > 0) — same sidestep
// admin-payments-calendar.spec.ts already uses for the identical reason.
test.describe("admin — worker debt payoff", () => {
  test("admin can pay off a worker's open session debt", async ({ page }) => {
    test.setTimeout(60_000);
    const laborCost = 180;
    const worker: TestWorker = await createTestWorker();
    const session = await createTestAttendanceSession(worker.id, { laborCost });
    let paymentId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto(`/payroll/workers/${worker.id}`);

      const addPaymentButton = page.getByRole("button", { name: "הוספת תשלום" });
      await expect(addPaymentButton).toBeVisible({ timeout: 15_000 });
      await addPaymentButton.click();

      await expect(page.getByText("הוספת תשלום לעובד")).toBeVisible();
      // Field (SalaryCenterUi.tsx) wraps a label div + its control in one
      // <label>, which should make an implicit label association — but
      // getByLabel("סכום") never resolved in CI. XPath on the label div's
      // own exact text, same fallback already proven for this shape in
      // admin-property-lease.spec.ts's CurrencyInput field, sidesteps
      // whatever breaks the accessible-name-based lookup.
      await page
        .locator('xpath=//div[text()="סכום"]/parent::label//input')
        .fill(String(laborCost));
      await page.getByRole("button", { name: "פיזור אוטומטי" }).click();

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/payroll/worker-payments") && r.request().method() === "POST"),
        page.getByRole("button", { name: "שמירת תשלום" }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { payment?: { id?: string } };
      paymentId = body.payment?.id ?? null;
      expect(paymentId).toBeTruthy();

      await expect.poll(async () => (await getSessionDebtStatus(session.id))?.payment_status).toBe("paid");
      const status = await getSessionDebtStatus(session.id);
      expect(status?.owed_amount).toBe(0);
      expect(status?.paid_amount).toBe(laborCost);
    } finally {
      if (paymentId) await deleteTestWorkerPayment(paymentId);
      await deleteTestAttendanceSession(session.id);
      await deleteTestWorker(worker);
    }
  });
});
