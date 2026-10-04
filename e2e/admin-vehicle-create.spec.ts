import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { getVehicleByTagName, deleteTestVehicle, type TestVehicle } from "./db";

// Creating a vehicle — VehiclesClient.tsx's own create dialog is ONLY
// reachable through the top bar's "+" quick-create menu (its "רכב" tile is a
// one-off route-scoped swap, shown only on /vehicles, dispatching a window
// event the page listens for — see QuickCreateMenu.tsx's own comment). A
// vehicle IS a tag (kind='vehicle') plus a structured `vehicles` detail row;
// createVehicle names the tag from the typed "שם הרכב" field directly, so the
// row is findable by that name once the (Server Action) write lands — no
// network response to await.
//
// Was skipped after three CI runs failed with getByLabel("שם הרכב") never
// resolving. VehicleFormFields wraps a <span> label and its Input in one
// <label> — the same implicit-label shape on which getByLabel also never
// resolved in admin-worker-debt-payoff.spec.ts. XPath on the label text
// sidesteps the accessible-name lookup; the dialog is scoped by its own
// "הוספת רכב" title so no other dialog on the page can be picked up.
test.describe("admin — vehicles", () => {
  test("admin can create a vehicle via the quick-create menu", async ({ page }) => {
    test.setTimeout(60_000);
    const name = `E2E vehicle ${Date.now()}`;
    let vehicle: TestVehicle | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/vehicles");

      await page.getByRole("button", { name: "הוספה מהירה" }).first().click();
      const vehicleTile = page.getByRole("button", { name: "רכב", exact: true });
      await expect(vehicleTile.first()).toBeVisible({ timeout: 15_000 });
      await vehicleTile.first().click();

      const dialog = page.getByRole("dialog").filter({ hasText: "הוספת רכב" });
      await expect(dialog).toBeVisible();
      const nameInput = dialog.locator('xpath=.//span[text()="שם הרכב"]/parent::label//input');
      await expect(nameInput).toBeVisible();
      await nameInput.fill(name);
      await dialog.getByRole("button", { name: "הוספה", exact: true }).click();

      await expect.poll(() => getVehicleByTagName(name)).not.toBeNull();
      vehicle = await getVehicleByTagName(name);
    } finally {
      if (vehicle) await deleteTestVehicle(vehicle);
    }
  });
});
