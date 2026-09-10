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
// KNOWN FLAKY (2026-09-10, first real run against a genuine local Supabase
// stack in CI - see foundation-hardening memory): fails with a 30s timeout
// waiting for the quick-add textarea after clicking .first() of 8 identical
// "הוספת כרטיס" buttons (2 per column x 4 columns - the top button uses
// aria-label, the bottom one uses the same string as visible text, so both
// get the same accessible name and getByLabel matches all of them). The
// failure snapshot at timeout shows every column back in its closed state,
// not stuck open - so either the click never landed on TasksPageClient.tsx's
// top button specifically, or something remounts/resets the column's local
// `adding` state shortly after. Not yet root-caused with certainty; needs a
// live trace/video, not just the failure snapshot, to pin down. Scope to the
// FIRST column specifically (not .first() across all 8) as a next step.
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
