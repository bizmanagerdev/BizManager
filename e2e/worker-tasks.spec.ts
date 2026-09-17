import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import { createTestWorker, deleteTestWorker, createTestTask, deleteTestTask, getTaskStatus, getAdminUserId } from "./db";

// Task-board permission scoping for the "worker" role. Goes through the
// app's real API routes (via page.request, which shares the logged-in
// session's cookies) rather than the board's own drag/quick-add UI —
// e2e/task-board.spec.ts already covers that interaction and is flagged
// flaky; these tests are about SERVER-SIDE enforcement (self-assignment,
// scoping, privacy, and the RLS identity fix), which a raw request proves
// more precisely and more reliably than a UI interaction would.
test.describe("worker role scoping — tasks", () => {
  test("a worker's created task is always self-assigned, even if a different assignee is requested", async ({
    page,
  }) => {
    const worker = await createTestWorker();
    const adminId = await getAdminUserId();
    let taskId: string | null = null;
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      const subject = `E2E worker self-assign ${Date.now()}`;
      const response = await page.request.post("/api/tasks/create", {
        data: { subject, assigned_user_id: adminId },
      });
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { assigned_user_id?: string; id?: string };
      taskId = body.id ?? null;

      // app/api/tasks/create/route.ts forces assigned_user_id to the
      // creator whenever role === "worker" — the request body's admin id
      // must never win.
      expect(body.assigned_user_id).toBe(worker.id);
    } finally {
      if (taskId) await deleteTestTask(taskId);
      await deleteTestWorker(worker);
    }
  });

  test("a worker's task board shows only his own tasks, not another worker's", async ({ page }) => {
    const workerA = await createTestWorker();
    const workerB = await createTestWorker();
    const otherTitle = `E2E not-mine task ${Date.now()}`;
    const otherTask = await createTestTask({ assignedUserId: workerB.id, subject: otherTitle });
    try {
      await loginWithCredentials(page, workerA.email, workerA.password);
      await page.waitForURL("**/dashboard");
      await page.goto("/tasks");

      await expect(page.getByText(otherTitle)).toHaveCount(0);
    } finally {
      await deleteTestTask(otherTask.id);
      await deleteTestWorker(workerA);
      await deleteTestWorker(workerB);
    }
  });

  test("a worker cannot see a private task assigned to him but owned by someone else", async ({ page }) => {
    const worker = await createTestWorker();
    const adminId = await getAdminUserId();
    const privateTitle = `E2E private-not-mine task ${Date.now()}`;
    // Assigned to the worker (so the plain "mine" scope WOULD normally show
    // it), but privately owned by the admin — tasks_privacy_restrict on
    // public.tasks must still hide it regardless of assignment.
    const privateTask = await createTestTask({
      assignedUserId: worker.id,
      subject: privateTitle,
      isPrivate: true,
      privateOwnerId: adminId,
    });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await page.goto("/tasks");

      await expect(page.getByText(privateTitle)).toHaveCount(0);
    } finally {
      await deleteTestTask(privateTask.id);
      await deleteTestWorker(worker);
    }
  });

  // Regression test for supabase/migrations/20260910130000_fix_worker_update_
  // own_tasks_identity.sql — createTestWorker deliberately gives the worker a
  // FRESH public.users.id distinct from its auth_user_id (the real-world
  // admin-provisioned shape), which is exactly what the old
  // `assigned_user_id = auth.uid()` policy could never match.
  test("a worker can mark his own assigned task done", async ({ page }) => {
    const worker = await createTestWorker();
    const task = await createTestTask({ assignedUserId: worker.id, status: "todo" });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      const response = await page.request.post("/api/tasks/update-status", {
        data: { id: task.id, status: "done" },
      });
      expect(response.ok()).toBe(true);

      // The route returns 200 even when RLS silently filters the update to
      // 0 rows (Supabase's update-then-select returns {data: null,
      // error: null}, not an error) — so the real proof is reading the row
      // back, not just the response status.
      await expect.poll(() => getTaskStatus(task.id)).toBe("done");
    } finally {
      await deleteTestTask(task.id);
      await deleteTestWorker(worker);
    }
  });
});
