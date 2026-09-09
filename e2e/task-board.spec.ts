import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { deleteTestTaskByTitle } from "./db";

// The Trello-style task board is the single highest-frequency action
// surface in the app — TaskUpsertDialog alone had 4 router.refresh() call
// sites fixed today (see project-performance memory) to stop saves from
// freezing the screen. This exercises the board's own quick-add path
// end-to-end: type a title, submit, and confirm the card actually appears
// — the real proof the fix didn't just avoid a crash but still works.
test.describe("task board", () => {
  test("quick-adding a task from the board shows the new card", async ({ page }) => {
    const title = `E2E משימת בדיקה ${Date.now()}`;
    await loginAs(page, "admin");
    await page.goto("/tasks");

    await page.getByLabel("הוספת כרטיס").first().click();
    const input = page.getByPlaceholder("כותרת המשימה");
    await input.fill(title);
    await input.press("Enter");

    await expect(page.getByText(title)).toBeVisible();

    await deleteTestTaskByTitle(title);
  });
});
