import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import {
  createTestWorker,
  deleteTestWorker,
  createTestTask,
  deleteTestTask,
  createTestDocument,
  deleteTestDocument,
  linkTestDocumentToTask,
} from "./db";

// Task attachments (components/tasks/TaskUpsertDialog.ui.tsx's
// TaskAttachmentsSection) — a worker can see attachments on any task he can
// already see (scoped through the task's own visibility, not a separate
// grant), but has no RLS delete permission at all
// (20260908110000_worker_task_attachment_rls.sql's own "no DELETE" note).
//
// Regression test for the fix this session: the delete button used to show
// for a worker regardless (TaskAttachmentsSection had no role check), so a
// click silently did nothing — no error, the row just came back on reload.
// It's now hidden outright for a worker (viewerRole prop threaded through
// TaskUpsertDialog → TaskAttachmentsSection).
test.describe("worker role scoping — task attachments", () => {
  test("a worker sees an attachment on his own task but no delete button", async ({ page }) => {
    const worker = await createTestWorker();
    const task = await createTestTask({ assignedUserId: worker.id, subject: `E2E attachment task ${Date.now()}` });
    // createTestDocument's file_name is always "test.pdf" — that's the
    // string the attachments-list route surfaces as original_name.
    const document = await createTestDocument();
    await linkTestDocumentToTask(document.id, task.id);
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await page.goto("/tasks");

      await page.getByText(task.subject).click();
      // The "files" section starts collapsed (accordion) — open it.
      await page.getByText("קבצים ותמונות").click();

      // Visibility works: the attachment (named via documents.file_name,
      // which /api/tasks/attachments/list returns as original_name) renders.
      await expect(page.getByText("test.pdf")).toBeVisible();
      // But the delete button — visible to any viewer before this fix,
      // silently non-functional for a worker either way — is now hidden.
      await expect(page.getByRole("button", { name: "מחיקת קובץ" })).toHaveCount(0);
    } finally {
      await deleteTestDocument(document.id);
      await deleteTestTask(task.id);
      await deleteTestWorker(worker);
    }
  });
});
