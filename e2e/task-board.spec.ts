import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { deleteTestTaskByTitle } from "./db";

// The Trello-style task board is the single highest-frequency action
// surface in the app — TaskUpsertDialog alone had 4 router.refresh() call
// sites fixed today (see project-performance memory) to stop saves from
// freezing the screen. This exercises the board's own quick-add path
// end-to-end: type a title, submit, and confirm the card actually appears
// — the real proof the fix didn't just avoid a crash but still works.
//
// ROOT-CAUSED 2026-09-17, two separate bugs: (1) `.first()` across all 8
// "הוספת כרטיס" buttons (2 per column x 4 columns) assumed DOM order always
// puts the "todo" column first — but column order is a per-user drag-reorder,
// persisted (TasksPageClient.tsx's own comment: "each user can drag to
// reorder"), so `.first()` could land on a DIFFERENT column's add button.
// Scoped to the "todo" column's own `data-column` attribute instead of
// relying on left-to-right position. (2) the final assertion raced the
// add-box's own close — see its own comment below.
test.describe("task board", () => {
  test("quick-adding a task from the board shows the new card", async ({ page }) => {
    const title = `E2E משימת בדיקה ${Date.now()}`;
    await loginAs(page, "admin");
    await page.goto("/tasks");

    await page.locator('[data-column="todo"]').getByLabel("הוספת כרטיס").first().click();
    const input = page.locator('[data-column="todo"]').getByPlaceholder("כותרת המשימה");
    await input.fill(title);
    await input.press("Enter");

    // The add-box's own textarea keeps the typed title as its value until
    // submitQuickAdd's onQuickAdd await resolves and closes it (setAdding(null))
    // — an unscoped getByText(title) can match that still-open textarea AND the
    // new card at once (strict-mode violation). Waiting for the box to actually
    // close is also the real signal that the submission completed, not just
    // that the optimistic card was drawn.
    await expect(input).toBeHidden();
    await expect(page.getByText(title)).toBeVisible();

    await deleteTestTaskByTitle(title);
  });
});
