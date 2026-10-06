import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import { createTestWorker, deleteTestWorker, deleteTestAttendanceReports, getLatestAttendanceReportStatus } from "./db";

// The phone version of worker-attendance.spec.ts — clocking in and out from
// the dashboard's shift card is what a worker mostly does on the phone, and
// on the Android app specifically. Same flow, same rules: the worker must
// track sessions (payrollWorkerType "session_only"), and "שליחה לאישור"
// goes through the 10s undo window before the report is written, hence the
// generous poll timeout.
test.describe("mobile — worker shift", () => {
  test("a worker can open a shift and submit it for approval on a phone", async ({ page }) => {
    const worker = await createTestWorker({ payrollWorkerType: "session_only" });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      await expect(page.getByText("שעון נוכחות")).toBeVisible();
      await page.getByRole("button", { name: "פתיחת משמרת" }).tap();
      await expect(page.getByText("המשמרת נפתחה.")).toBeVisible();
      await expect(page.getByText(/משמרת פתוחה מ/)).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: "סיום משמרת" }).tap();
      await page.getByRole("button", { name: "שליחה לאישור" }).tap();
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
