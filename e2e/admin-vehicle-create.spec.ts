import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { getVehicleByTagName, deleteTestVehicle, type TestVehicle } from "./db";

// Creating a vehicle had no E2E coverage — VehiclesClient.tsx's own create
// dialog is ONLY reachable through the top bar's "+" quick-create menu (its
// "רכב" tile is a one-off route-scoped swap, shown only on /vehicles,
// dispatching a window event the page listens for — see QuickCreateMenu.tsx's
// own comment). A vehicle IS a tag (kind='vehicle') plus a structured
// `vehicles` detail row; createVehicle names the tag from the typed "שם
// הרכב" field directly when given, so the row is findable by that name
// once the (Server Action) write lands — no network response to await.
test.describe("admin — vehicles", () => {
  test("admin can create a vehicle via the quick-create menu", async ({ page }) => {
    test.setTimeout(60_000);
    const name = `E2E vehicle ${Date.now()}`;
    let vehicle: TestVehicle | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/vehicles");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      const vehicleTile = page.getByRole("button", { name: "רכב" });
      await expect(vehicleTile).toBeVisible({ timeout: 15_000 });
      await vehicleTile.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const nameField = dialog.getByLabel("שם הרכב");
      try {
        await nameField.fill(name, { timeout: 10_000 });
      } catch (err) {
        // DIAGNOSTIC: the dialog IS visible but this label never resolves —
        // dump what's actually inside it so the real cause (wrong dialog?
        // fields not mounted? a different label text?) is visible in the
        // failure message instead of a bare timeout.
        const html = await dialog.innerHTML().catch(() => "<could not read innerHTML>");
        throw new Error(`"שם הרכב" field not found in dialog. Dialog HTML:\n${html}\n\nOriginal error: ${err}`);
      }
      await dialog.getByRole("button", { name: "הוספה" }).click();

      await expect.poll(() => getVehicleByTagName(name)).not.toBeNull();
      vehicle = await getVehicleByTagName(name);

      await expect(page.getByText(name)).toBeVisible();
    } finally {
      if (vehicle) await deleteTestVehicle(vehicle);
    }
  });
});
