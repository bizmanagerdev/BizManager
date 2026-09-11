import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import { createTestWorker, deleteTestWorker } from "./db";

// Comprehensive route/nav access matrix for the "worker" role — see
// lib/auth/sections.ts (the section_access map: dashboard/deliveries/tasks/
// calendar/vehicles) and lib/auth/roleAccess.ts (requireStaffPage/
// requireAdminPage — every non-worker-section route). Each test provisions
// its OWN worker via createTestWorker (a real, separately-provisioned
// account — never the shared e2e-worker@bizh.test fixture), since
// playwright.config.ts runs fullyParallel and section_access can't safely be
// mutated on a worker other specs are logging in as concurrently.
//
// e2e/role-access.spec.ts already covers the /financial case for the seeded
// worker — this file is the fuller matrix (all 5 sections + several more
// staff-only routes + the worker_no_access role + the always-allowed
// prefixes), not a duplicate of that one check.

test.describe("worker role scoping — nav and route access", () => {
  test("default section access: sees dashboard/deliveries/tasks/calendar, not vehicles", async ({ page }) => {
    const worker = await createTestWorker();
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      await expect(page.getByRole("link", { name: "משלוחים" })).toBeVisible();
      await expect(page.getByRole("link", { name: "משימות" })).toBeVisible();
      await expect(page.getByRole("link", { name: "יומן" })).toBeVisible();
      await expect(page.getByRole("link", { name: "רכבים" })).toHaveCount(0);
    } finally {
      await deleteTestWorker(worker);
    }
  });

  test("vehicles access off: hidden from nav AND /vehicles redirects to /no-access", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { vehicles: false } });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await expect(page.getByRole("link", { name: "רכבים" })).toHaveCount(0);

      await page.goto("/vehicles");
      await page.waitForURL("**/no-access");
    } finally {
      await deleteTestWorker(worker);
    }
  });

  test("vehicles access on: shown in nav AND /vehicles is reachable", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { vehicles: true } });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await expect(page.getByRole("link", { name: "רכבים" })).toBeVisible();

      await page.goto("/vehicles");
      await expect(page).not.toHaveURL(/\/no-access/);
    } finally {
      await deleteTestWorker(worker);
    }
  });

  test("deliveries access off: hidden from nav AND /deliveries redirects to /no-access", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { deliveries: false } });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await expect(page.getByRole("link", { name: "משלוחים" })).toHaveCount(0);

      await page.goto("/deliveries");
      await page.waitForURL("**/no-access");
    } finally {
      await deleteTestWorker(worker);
    }
  });

  test("tasks access off: hidden from nav AND /tasks redirects to /no-access", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { tasks: false } });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await expect(page.getByRole("link", { name: "משימות" })).toHaveCount(0);

      await page.goto("/tasks");
      await page.waitForURL("**/no-access");
    } finally {
      await deleteTestWorker(worker);
    }
  });

  test("calendar access off: hidden from nav AND /calendar redirects to /no-access", async ({ page }) => {
    const worker = await createTestWorker({ sectionAccess: { calendar: false } });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");
      await expect(page.getByRole("link", { name: "יומן" })).toHaveCount(0);

      await page.goto("/calendar");
      await page.waitForURL("**/no-access");
    } finally {
      await deleteTestWorker(worker);
    }
  });

  // Staff-only routes: not in WORKER_SECTIONS at all, so no amount of
  // section_access ever grants them — gated by requireStaffPage/
  // requireAdminPage instead, regardless of what's in section_access.
  const STAFF_ONLY_ROUTES = ["/financial", "/payroll", "/customers", "/settings", "/projects", "/properties"];
  for (const route of STAFF_ONLY_ROUTES) {
    test(`staff-only route ${route} redirects a worker to /no-access`, async ({ page }) => {
      const worker = await createTestWorker();
      try {
        await loginWithCredentials(page, worker.email, worker.password);
        await page.waitForURL("**/dashboard");
        await page.goto(route);
        await page.waitForURL("**/no-access");
      } finally {
        await deleteTestWorker(worker);
      }
    });
  }

  test("role=worker_no_access is always redirected to /no-access, even straight after login", async ({ page }) => {
    const worker = await createTestWorker({ role: "worker_no_access" });
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/no-access");
      await expect(page.getByRole("heading", { name: "אין גישה" })).toBeVisible();
    } finally {
      await deleteTestWorker(worker);
    }
  });

  test("a worker can always reach /profile, /inbox and /notifications regardless of section access", async ({
    page,
  }) => {
    const worker = await createTestWorker({
      sectionAccess: { dashboard: false, deliveries: false, tasks: false, calendar: false, vehicles: false },
    });
    try {
      // With every section off, login lands wherever firstAccessiblePrefix
      // sends him (or /no-access) — don't assert on that, just confirm the
      // always-allowed prefixes work regardless.
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForLoadState("domcontentloaded");

      for (const path of ["/profile", "/inbox", "/notifications"]) {
        await page.goto(path);
        await expect(page).not.toHaveURL(/\/no-access/);
      }
    } finally {
      await deleteTestWorker(worker);
    }
  });
});
