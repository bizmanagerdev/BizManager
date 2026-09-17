import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import { createTestWorker, deleteTestWorker, deleteTestAttendanceReports, getLatestAttendanceReportStatus } from "./db";

// The dashboard clock card (components/attendance/MyShiftCard.tsx) — a
// worker's own open-shift / submit-for-approval flow. Requires
// payrollWorkerType: "session_only" (or "hourly_payslip") specifically:
// /api/attendance/my/start 409s for "monthly_payslip" (the createTestWorker
// default) via payrollWorkerTypeAllowsSessions() — confirmed by reading the
// route, not assumed.
//
// closeShift() goes through lib/undo-engine.ts's scheduleDeferredAction with
// the DEFAULT 10s undo window — the toast and optimistic UI update fire
// immediately, but the real /api/attendance/my/close call (and the DB row it
// writes) only lands ~10s later. expect.poll's generous timeout below
// accounts for that; it is not test flakiness padding.
test.describe("worker role scoping — attendance clock", () => {
  test("a worker can open a shift and submit it for approval", async ({ page }) => {
    const worker = await createTestWorker({ payrollWorkerType: "session_only" });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      await expect(page.getByText("שעון נוכחות")).toBeVisible();
      await page.getByRole("button", { name: "פתיחת משמרת" }).click();
      await expect(page.getByText("המשמרת נפתחה.")).toBeVisible();
      // The heading only shows "משמרת פתוחה מ..." once openShiftProp reflects
      // the new shift — a real server round trip via router.refresh()
      // (MyShiftCard.tsx), not an optimistic local update like the toast
      // above. Same class of real-round-trip slowness this file already
      // budgets extra time for below (expect.poll's 15s timeout).
      await expect(page.getByText(/משמרת פתוחה מ/)).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: "סיום משמרת" }).click();
      await page.getByRole("button", { name: "שליחה לאישור" }).click();
      await expect(page.getByText("המשמרת נשלחה לאישור.")).toBeVisible();

      await expect.poll(() => getLatestAttendanceReportStatus(worker.id), { timeout: 15_000 }).toBe(
        "pending_review"
      );
    } finally {
      await deleteTestAttendanceReports(worker.id);
      await deleteTestWorker(worker);
    }
  });
});
