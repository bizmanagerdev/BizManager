import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestTask, deleteTestTask, getAdminUserId, getTaskStatus } from "./db";

// MyTasksPanel (components/dashboard/MyTasksPanel.tsx), the "המשימות שלי"
// dashboard card, is the clearest example of this app's "cards are
// actionable, not stat tiles" rule (see dashboard-actionable-cards memory) —
// each row's checkbox is a REAL mark-done action, not just a link. It's also
// the simplest dashboard widget to seed deterministically: getMyTasks()
// (lib/dashboard/tasks-overview.ts) is a plain `assigned_user_id = me AND
// status in OPEN_TASK_STATUSES` query with no date window, it's in the
// default widget order (lib/dashboard/widgets.ts) for every role, and the
// e2e-admin fixture never has saved dashboard_prefs to complicate the
// resolved layout. markDone() goes through lib/undo-engine.ts's
// scheduleDeferredAction — the row disappears from the list optimistically
// on click (same render pass), but the real PATCH (/api/tasks/update-status)
// only lands after the default 10s undo window.
test.describe("admin — dashboard tasks card", () => {
  test("admin can mark a task done from the dashboard card", async ({ page }) => {
    test.setTimeout(60_000);
    const adminId = await getAdminUserId();
    const task = await createTestTask({ assignedUserId: adminId, status: "todo" });
    try {
      await loginAs(page, "admin");

      const row = page.getByRole("listitem").filter({ hasText: task.subject });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "סימון המשימה כבוצעה" }).click();

      // Optimistic: the row is gone from the list immediately, well before the
      // undo window's real write lands.
      await expect(row).toBeHidden();

      await expect.poll(() => getTaskStatus(task.id), { timeout: 15_000 }).toBe("done");
    } finally {
      await deleteTestTask(task.id);
    }
  });
});
