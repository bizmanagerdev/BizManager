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
// Was skipped after three CI runs found "a dialog" with no "שם הרכב" in it —
// it was a leftover vehicle card's dialog, opened by clicking the wrong "רכב"
// button (see below). The name field is reached by XPath on its label text
// (VehicleFormFields wraps label + input in one <label>, a shape getByLabel
// also failed on in admin-worker-debt-payoff.spec.ts), and the dialog is
// scoped by its own "הוספת רכב" title.
test.describe("admin — vehicles", () => {
  test("admin can create a vehicle via the quick-create menu", async ({ page }) => {
    test.setTimeout(60_000);
    const name = `E2E vehicle ${Date.now()}`;
    let vehicle: TestVehicle | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/vehicles");

      // The desktop "+" opens on pointer-enter AND toggles on click, so a
      // Playwright click (which hovers first) can open then shut it — hover
      // alone opens it. Its panel is portaled to the end of <body>, AFTER the
      // page's own vehicle cards, and a vehicle with no name/plate/model is
      // displayed as plain "רכב" (lib/vehicles.ts) — so .first() used to click
      // a leftover vehicle card instead of the tile. .last() is the tile.
      const vehicleTile = page.getByRole("button", { name: "רכב", exact: true }).last();
      const dialog = page.getByRole("dialog").filter({ hasText: "הוספת רכב" });
      await expect(async () => {
        await page.locator("#topbar-quick-create-trigger").hover();
        await expect(vehicleTile).toBeVisible({ timeout: 2_000 });
        await vehicleTile.click();
        await expect(dialog).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
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
