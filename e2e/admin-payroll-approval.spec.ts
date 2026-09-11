import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestWorker,
  deleteTestWorker,
  createTestAttendanceReport,
  getAttendanceReportStatus,
  getAttendanceSessionForReport,
  deleteTestAttendanceSession,
  deleteTestAttendanceReports,
} from "./db";

// The admin/office counterpart to the worker's own "clock in, submit for
// approval" flow (worker-attendance.spec.ts) — approving a pending report is
// what actually feeds payroll: it inserts a real attendance_sessions row
// (app/api/attendance/phone-reports/approve/route.ts), not just a status flip.
//
// /payroll/attendance is a SHARED page listing every pending report system-
// wide, and playwright.config.ts runs fullyParallel — so every locator here
// is scoped to this test's own card via its data-focus-id={report.id}
// (PendingReportCard.tsx:457), never a bare page-wide button query.
test.describe("admin — payroll attendance approval", () => {
  test("admin can approve a pending report, creating a real attendance session", async ({ page }) => {
    const worker = await createTestWorker({ payrollWorkerType: "session_only" });
    const report = await createTestAttendanceReport(worker.id);
    let sessionId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/payroll/attendance");

      const card = page.locator(`[data-focus-id="${report.id}"]`);
      await expect(card).toBeVisible();

      await card.locator('[aria-label="תחום עסקי"]').click();
      await page.getByRole("button", { name: "שוטף", exact: true }).click();

      await card.getByRole("button", { name: "אישור" }).click();

      await expect.poll(() => getAttendanceReportStatus(report.id)).toBe("approved");
      const session = await getAttendanceSessionForReport(report.id);
      expect(session).not.toBeNull();
      sessionId = session?.id ?? null;
    } finally {
      if (sessionId) await deleteTestAttendanceSession(sessionId);
      await deleteTestAttendanceReports(worker.id);
      await deleteTestWorker(worker);
    }
  });
});
