import type { Page } from "@playwright/test";

// Matches supabase/seed.sql — three logins, one per role, all sharing this
// password. See e2e/README.md.
export const E2E_USERS = {
  admin: { email: "e2e-admin@bizh.test", password: "e2e-test-password-123" },
  office: { email: "e2e-office@bizh.test", password: "e2e-test-password-123" },
  worker: { email: "e2e-worker@bizh.test", password: "e2e-test-password-123" },
} as const;

export type E2ERole = keyof typeof E2E_USERS;

/** Fills and submits the login form, and waits for the post-login redirect. */
export async function loginAs(page: Page, role: E2ERole) {
  const { email, password } = E2E_USERS[role];
  await page.goto("/login");
  // The form's <label>s aren't programmatically associated with their inputs
  // (no htmlFor/id), so getByLabel can't find them — target by input type
  // instead (the password field's type toggles on a show/hide click, but
  // starts as "password", so this is safe before any such interaction).
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "התחברות" }).click();
  await page.waitForURL("**/dashboard");
}
