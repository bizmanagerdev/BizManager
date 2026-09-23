import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestWorker,
  deleteTestWorker,
  createTestAttendanceSession,
  deleteTestAttendanceSession,
  getSessionDebtStatus,
  deleteTestWorkerPaymentsForUser,
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
    try {
      await loginAs(page, "admin");
      await page.goto(`/payroll/workers/${worker.id}`);

      const addPaymentButton = page.getByRole("button", { name: "הוספת תשלום" });
      await expect(addPaymentButton).toBeVisible({ timeout: 15_000 });
      await addPaymentButton.click();

      await expect(page.getByText("הוספת תשלום לעובד")).toBeVisible();
      // Field (SalaryCenterUi.tsx) wraps a label div + its control in one
      // <label>, which should make an implicit label association — but
      // getByLabel("סכום") never resolved in CI (round 1), and the XPath
      // fallback below (round 2, same pattern already proven for this shape
      // in admin-property-lease.spec.ts) hit only an uninformative bare
      // test-timeout with no pinpointed line — likely GitHub's own
      // annotation cap (this session's runs regularly hit 30+ failures) ate
      // the detailed one. Split visible+enabled out explicitly so a real
      // failure lands on a specific line even if the detailed annotation
      // gets dropped again.
      const amountInput = page.locator('xpath=//div[text()="סכום"]/parent::label//input');
      await expect(amountInput).toBeVisible({ timeout: 10_000 });
      await amountInput.fill(String(laborCost));

      // "פיזור אוטומטי" (FormDialog's allocations section, SalaryCenterClient.
      // tsx) has no explicit type="button" — Button (components/ui/button.tsx)
      // never defaults one, so the native <button> default of type="submit"
      // applies. FormDialog wraps its whole body, allocations section
      // included, in one <form onSubmit={(e) => { e.preventDefault();
      // onSubmit(); }}>: preventDefault only stops the browser's own
      // navigation, not the React handler, so clicking this button ALSO
      // fires saveWorkerPayment() immediately — confirmed in CI: the dialog
      // was already gone by the time the next line looked for "שמירת תשלום".
      // The auto-distribute click IS the submit here.
      const autoDistribute = page.getByRole("button", { name: "פיזור אוטומטי" });
      await expect(autoDistribute).toBeVisible();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/payroll/worker-payments") && r.request().method() === "POST"),
        autoDistribute.click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { payment?: { id?: string } };
      expect(body.payment?.id).toBeTruthy();

      await expect.poll(async () => (await getSessionDebtStatus(session.id))?.payment_status).toBe("paid");
      const status = await getSessionDebtStatus(session.id);
      expect(status?.owed_amount).toBe(0);
      expect(status?.paid_amount).toBe(laborCost);
    } finally {
      // By worker.id, not a captured payment id: a save that genuinely
      // succeeds server-side but whose response a later assertion fails to
      // parse/verify (this test's own actual CI failure, once) would
      // otherwise leave a REAL worker_payments row behind with nothing in
      // this test having learned its id, blocking deleteTestWorker below on
      // worker_payments_user_id_fkey (no ON DELETE action, RESTRICT).
      await deleteTestWorkerPaymentsForUser(worker.id);
      await deleteTestAttendanceSession(session.id);
      await deleteTestWorker(worker);
    }
  });
});
