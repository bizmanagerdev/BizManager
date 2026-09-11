import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import {
  createTestWorker,
  deleteTestWorker,
  createTestVehicle,
  deleteTestVehicle,
  createTestExpense,
  deleteTestExpense,
  createTestDocument,
  deleteTestDocument,
  tagEntityAsVehicle,
  getVehicleMileage,
} from "./db";

// section_access.vehicles is the newest, most-patched worker permission in
// the app (6 migrations between 2026-09-07 and 2026-09-09, each fixing a gap
// the previous one left — see foundation-hardening memory) — full staff-
// equivalent access to a car's expenses/documents/payments/tasks once
// granted, nothing at all otherwise.
test.describe("worker role scoping — vehicles section", () => {
  test("vehicles access on: worker can open the vehicle detail page and see an expense tagged to it", async ({
    page,
  }) => {
    const worker = await createTestWorker({ sectionAccess: { vehicles: true } });
    const vehicle = await createTestVehicle();
    const expense = await createTestExpense();
    await tagEntityAsVehicle("expense", expense.id, vehicle.tagId);
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      await page.goto(`/vehicles/${vehicle.tagId}`);
      await expect(page).not.toHaveURL(/\/no-access/);
      // A freshly-created vehicle has exactly this one tagged expense.
      await expect(page.getByText("הוצאות (1)")).toBeVisible();
    } finally {
      await deleteTestExpense(expense.id);
      await deleteTestVehicle(vehicle);
      await deleteTestWorker(worker);
    }
  });

  test("vehicles access off: worker cannot open a vehicle detail page directly", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { vehicles: false } });
    const vehicle = await createTestVehicle();
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      await page.goto(`/vehicles/${vehicle.tagId}`);
      await page.waitForURL("**/no-access");
    } finally {
      await deleteTestVehicle(vehicle);
      await deleteTestWorker(worker);
    }
  });

  test("vehicles access on: worker can see a document tagged to the vehicle", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { vehicles: true } });
    const vehicle = await createTestVehicle();
    const document = await createTestDocument();
    await tagEntityAsVehicle("document", document.id, vehicle.tagId);
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      await page.goto(`/vehicles/${vehicle.tagId}`);
      // A freshly-created vehicle has exactly this one tagged document.
      await expect(page.getByText("מסמכים (1)")).toBeVisible();
    } finally {
      await deleteTestDocument(document.id);
      await deleteTestVehicle(vehicle);
      await deleteTestWorker(worker);
    }
  });

  test("vehicles access on: worker can log a mileage reading", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { vehicles: true } });
    const vehicle = await createTestVehicle();
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await page.goto(`/vehicles/${vehicle.tagId}`);

      // Unset state: dashed row, "קילומטרים" + "הגדרה".
      await page.getByRole("button", { name: /קילומטרים.*הגדרה/ }).click();
      await page.getByRole("dialog").getByRole("textbox").fill("12345");
      await page.getByRole("button", { name: "שמירה" }).click();

      // The optimistic patch shows the number immediately; the real write
      // (addVehicleMileageReading) goes through lib/undo-engine.ts's
      // scheduleDeferredEdit with the default 10s undo window — same
      // pattern as the attendance close flow elsewhere in this suite.
      await expect(page.getByText("12,345")).toBeVisible();
      await expect.poll(() => getVehicleMileage(vehicle.tagId), { timeout: 15_000 }).toBe(12345);
    } finally {
      await deleteTestVehicle(vehicle);
      await deleteTestWorker(worker);
    }
  });

  test("vehicles access on: worker can delete an expense tagged to the vehicle but recorded by someone else", async ({
    page,
  }) => {
    const worker = await createTestWorker({ sectionAccess: { vehicles: true } });
    const vehicle = await createTestVehicle();
    // createTestExpense records it under the admin fixture, not this worker —
    // exactly the "not mine but tagged to a car I manage" case
    // 20260907102351_worker_vehicle_full_control.sql exists for.
    const expense = await createTestExpense({ description: "הוצאה של מישהו אחר" });
    await tagEntityAsVehicle("expense", expense.id, vehicle.tagId);
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await page.goto(`/vehicles/${vehicle.tagId}`);

      await expect(page.getByText("הוצאות (1)")).toBeVisible();
      // Exactly one expense exists on this freshly-tagged vehicle, so the
      // desktop RowActionsMenu trigger (aria-label="פעולות") is unambiguous
      // without needing to scope to a specific row.
      await page.getByRole("button", { name: "פעולות" }).click();
      await page.getByRole("menuitem", { name: "מחיקת הוצאה" }).click();
      await page.getByRole("button", { name: "מחיקה" }).click();

      await expect(page.getByText("הוצאות (0)")).toBeVisible();
    } finally {
      await deleteTestVehicle(vehicle);
      await deleteTestWorker(worker);
    }
  });
});
