import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestWorker, deleteTestWorker, createTestAttendanceReport, deleteTestAttendanceReports } from "./db";
import { hebrewWeekday, formatShortDate } from "@/lib/date";

// AttendanceApprovals ("נוכחות עובדים לאישור") shares its actual approve/
// reject/split form (PendingReportCard) with /payroll/attendance's own queue
// page — admin-payroll-approval.spec.ts already exercises that shared form
// end to end, so re-testing approval here would just duplicate it. What's
// genuinely dashboard-specific is the day-group fold: reports start collapsed
// under a "<weekday> <date>" toggle (AttendanceApprovals.tsx's groupByDay),
// and each report row is a focus deep link to the real queue
// (?focus=<reportId>) rather than the destination itself — that's the
// untested part. dayLabel() is reproduced here from the same lib/date.ts
// helpers the component itself calls, so the locator matches exactly
// regardless of today's actual weekday/date.
test.describe("admin — dashboard attendance queue card", () => {
  test("expanding today's group and opening a report focuses it on the queue page", async ({ page }) => {
    test.setTimeout(60_000);
    const worker = await createTestWorker();
    const report = await createTestAttendanceReport(worker.id);
    try {
      await loginAs(page, "admin");

      const nowIso = new Date().toISOString();
      const dayLabel = `${hebrewWeekday(nowIso)} ${formatShortDate(nowIso)}`;
      await page.getByRole("button", { name: dayLabel }).first().click();

      const reportLink = page.getByRole("link", { name: `דיווח הנוכחות של ${worker.fullName}` });
      await expect(reportLink).toBeVisible();
      await reportLink.click();

      await page.waitForURL((url) => url.pathname === "/payroll/attendance" && url.searchParams.get("focus") === report.id);
      await expect(page.locator(`[data-focus-id="${report.id}"]:visible`).first()).toBeVisible();
    } finally {
      await deleteTestAttendanceReports(worker.id);
      await deleteTestWorker(worker);
    }
  });
});
