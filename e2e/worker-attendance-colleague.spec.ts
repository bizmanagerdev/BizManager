import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import {
  createTestWorker,
  deleteTestWorker,
  deleteTestAttendanceReports,
  getLatestAttendanceReportStatus,
  getAdminUserId,
} from "./db";

// "a worker can log a colleague's full manual shift" used to fail with
// "אין הרשאה לבצע את הפעולה": the route inserted with .insert().select(),
// and RETURNING needs a SELECT policy too — a worker can see only a
// colleague's OPEN rows (phone_attendance_worker_select_open_coworkers), so
// reading back a colleague's pending_review row was refused even though the
// insert itself was allowed. The route now mints the id itself and inserts
// without reading back.
//
// "Sign in a colleague" (components/attendance/AttendanceLogDialog.tsx,
// opened from the quick-create "דיווח נוכחות" tile) — tested via its real
// API route (/api/attendance/phone-reports/manual) rather than the dialog's
// own worker picker, which is a SearchableSelect (Radix Popper-family,
// already flagged flaky/slow-to-open elsewhere in this suite — see
// project-performance memory's "Popper-family gets closed-state/prop-driven
// tests only" note). This is pure RLS/permission testing (no client-side
// display bug here), so the API route proves the same thing more reliably.
test.describe("worker role scoping — signing in a colleague's attendance", () => {
  test("a worker can sign in a colleague (immediate clock-in)", async ({ page }) => {
    const signer = await createTestWorker();
    const colleague = await createTestWorker({ payrollWorkerType: "session_only" });
    try {
      await loginWithCredentials(page, signer.email, signer.password);
      await page.waitForURL("**/dashboard");

      const response = await page.request.post("/api/attendance/phone-reports/manual", {
        data: { user_id: colleague.id, clock_in: new Date().toISOString() },
      });
      expect(response.ok()).toBe(true);
      await expect.poll(() => getLatestAttendanceReportStatus(colleague.id)).toBe("open");
    } finally {
      await deleteTestAttendanceReports(colleague.id);
      await deleteTestWorker(signer);
      await deleteTestWorker(colleague);
    }
  });

  test("a worker can log a colleague's full manual shift, straight to pending review", async ({ page }) => {
    const signer = await createTestWorker();
    const colleague = await createTestWorker({ payrollWorkerType: "session_only" });
    try {
      await loginWithCredentials(page, signer.email, signer.password);
      await page.waitForURL("**/dashboard");

      const clockIn = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const clockOut = new Date().toISOString();
      const response = await page.request.post("/api/attendance/phone-reports/manual", {
        data: { user_id: colleague.id, clock_in: clockIn, clock_out: clockOut },
      });
      expect(response.ok()).toBe(true);
      await expect.poll(() => getLatestAttendanceReportStatus(colleague.id)).toBe("pending_review");
    } finally {
      await deleteTestAttendanceReports(colleague.id);
      await deleteTestWorker(signer);
      await deleteTestWorker(colleague);
    }
  });

  test("a worker cannot sign in an admin", async ({ page }) => {
    const signer = await createTestWorker();
    const adminId = await getAdminUserId();
    try {
      await loginWithCredentials(page, signer.email, signer.password);
      await page.waitForURL("**/dashboard");

      const response = await page.request.post("/api/attendance/phone-reports/manual", {
        data: { user_id: adminId, clock_in: new Date().toISOString() },
      });
      // The route looks the target up through user_directory(), which lets a
      // worker see everyone's name and role (it used to read `users`, where
      // RLS hid the admin entirely and this came back 404). The admin is now
      // found and refused by role. The RLS insert policy
      // (phone_attendance_worker_insert: is_payroll_worker(user_id)) would
      // refuse it independently even if the route didn't.
      expect(response.status()).toBe(400);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toBe("ניתן לבחור רק עובד.");
    } finally {
      await deleteTestWorker(signer);
    }
  });

  test("a worker cannot sign in a colleague whose worker type doesn't track sessions", async ({ page }) => {
    const signer = await createTestWorker();
    const colleague = await createTestWorker({ payrollWorkerType: "monthly_payslip" });
    try {
      await loginWithCredentials(page, signer.email, signer.password);
      await page.waitForURL("**/dashboard");

      const response = await page.request.post("/api/attendance/phone-reports/manual", {
        data: { user_id: colleague.id, clock_in: new Date().toISOString() },
      });
      expect(response.status()).toBe(409);
    } finally {
      await deleteTestWorker(signer);
      await deleteTestWorker(colleague);
    }
  });
});
