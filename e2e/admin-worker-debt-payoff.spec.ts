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
// (worker_debt_items_view). worker_debt_items_view's session_items CTE
// keys off users.pay_tracking_mode (a DB-defaulted 'session', separate
// column createTestWorker() never sets) — so a directly seeded
// attendance_sessions row with labor_cost > 0 shows up as a payable debt
// item immediately regardless of payrollWorkerType, no payroll period/
// payslip machinery or date gating involved (getPayableDebtAmount only
// special-cases payslip items). But the SAVE route (app/api/payroll/
// worker-payments/route.ts) checks a DIFFERENT column for what allocation
// type it'll accept: normalizePayrollWorkerType() trusts users.
// payroll_worker_type directly whenever it's already a valid value, so a
// worker left at createTestWorker()'s own default ("monthly_payslip") gets
// rejected for a "session" allocation with a 400 ("must be allocated by
// payslip") even though the debt item itself is genuinely session-sourced —
// payrollWorkerType: "session_only" keeps both columns consistent. No
// account is seeded on purpose: AccountSelect renders nothing at all with
// zero accounts, and account_id is only required client-side when the list
// is non-empty (workerPaymentAccountsList.length > 0) — same sidestep
// admin-payments-calendar.spec.ts already uses for the identical reason.
test.describe("admin — worker debt payoff", () => {
  test("admin can pay off a worker's open session debt", async ({ page }) => {
    test.setTimeout(60_000);
    const laborCost = 180;
    const worker: TestWorker = await createTestWorker({ payrollWorkerType: "session_only" });
    const session = await createTestAttendanceSession(worker.id, { laborCost });
    try {
      await loginAs(page, "admin");
      await page.goto(`/payroll/workers/${worker.id}`);

      // The debt items the dialog will offer to allocate against come from
      // a SEPARATE, slower fetch than the page itself — /api/payroll/center/
      // protected (SalaryCenterClient.tsx's loadProtectedData, "balances,
      // payments, session costs"), gated by its own protectedLoading flag.
      // "הוספת תשלום" is clickable before that resolves, and
      // openWorkerPaymentDialog() snapshots selectedWorkerOpenDebtItems at
      // CLICK TIME — opening early gets a dialog with zero allocations no
      // matter how long you wait once it's open (confirmed in CI: the
      // allocation field genuinely never existed). Wait for the payment
      // HISTORY section (fed by the same fetch) to show its loaded state —
      // a fresh worker has none yet — as a proxy for the fetch being done.
      await expect(page.getByText("אין תשלומים בתקופה שנבחרה")).toBeVisible({ timeout: 15_000 });

      const addPaymentButton = page.getByRole("button", { name: "הוספת תשלום" });
      await expect(addPaymentButton).toBeVisible();
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

      // Deliberately NOT "פיזור אוטומטי": that button has no type="button"
      // (Button, components/ui/button.tsx, never defaults one), so it's a
      // native type="submit" sitting inside FormDialog's one <form> around
      // the whole body, allocations section included. Its own onClick
      // (setWorkerPaymentForm distributing the amount) and the form's
      // onSubmit (saveWorkerPayment, only preventDefault()ing the browser's
      // own navigation) both fire off the SAME click — confirmed in CI: the
      // save request goes out with the allocation still at its PRE-click
      // empty state, creating a real but wholly UNALLOCATED payment
      // (payment_status stayed "unpaid"). Filling the one open debt item's
      // own "סכום להקצאה" field directly, then using the real submit button,
      // sidesteps that race entirely.
      const allocationInput = page.locator('xpath=//div[text()="סכום להקצאה"]/parent::label//input');
      await expect(allocationInput).toBeVisible();
      await allocationInput.fill(String(laborCost));

      const saveButton = page.getByRole("button", { name: "שמירת תשלום" });
      await expect(saveButton).toBeVisible();
      await expect(saveButton).toBeEnabled();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/payroll/worker-payments") && r.request().method() === "POST"),
        saveButton.click(),
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
