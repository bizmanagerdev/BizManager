import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestCustomer,
  createTestOrder,
  createTestProject,
  createTestProperty,
  createTestVehicle,
  deleteTestCustomer,
  deleteTestOrder,
  deleteTestProject,
  deleteTestProperty,
  deleteTestVehicle,
} from "./db";

// Detail "card" pages (customer/project/order/vehicle/property/loan/payroll
// worker) each chain several independent reads keyed off the entity id —
// exactly the kind of page where a query/prop-shape mismatch shows up as a
// hard runtime crash, not a unit-test failure (unit tests mock Supabase and
// never actually render these against a real browser). This confirms the
// page renders its real content instead of falling into
// app/(app)/error.tsx's boundary. See project-performance memory for why
// these two pages specifically were rewritten most heavily.
const ERROR_BOUNDARY_TEXT = "אירעה תקלה בטעינת הדף";

test.describe("detail page smoke tests", () => {
  test("customer detail page renders without crashing", async ({ page }) => {
    const customer = await createTestCustomer();
    try {
      await loginAs(page, "admin");
      await page.goto(`/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
      await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    } finally {
      await deleteTestCustomer(customer.id);
    }
  });

  test("project detail page renders without crashing", async ({ page }) => {
    const customer = await createTestCustomer();
    const project = await createTestProject(customer.id);
    try {
      await loginAs(page, "admin");
      await page.goto(`/projects/${project.id}`);
      await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
      await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    } finally {
      await deleteTestProject(project.id);
      await deleteTestCustomer(customer.id);
    }
  });

  test("order detail page renders without crashing", async ({ page }) => {
    const customer = await createTestCustomer();
    const order = await createTestOrder(customer.id);
    try {
      await loginAs(page, "admin");
      await page.goto(`/sales/orders/${order.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
      await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    } finally {
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
    }
  });

  test("property detail page renders without crashing", async ({ page }) => {
    const property = await createTestProperty();
    try {
      await loginAs(page, "admin");
      await page.goto(`/properties/${property.id}`);
      await expect(page.getByRole("heading", { name: property.address })).toBeVisible();
      await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    } finally {
      await deleteTestProperty(property.id);
    }
  });

  test("vehicle detail page renders without crashing", async ({ page }) => {
    const vehicle = await createTestVehicle();
    try {
      await loginAs(page, "admin");
      await page.goto(`/vehicles/${vehicle.tagId}`);
      await expect(page).not.toHaveURL(/\/no-access/);
      await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    } finally {
      await deleteTestVehicle(vehicle);
    }
  });
});
