import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestCustomer,
  deleteTestCustomer,
  getAdminUserId,
  setUserDigestSeenAt,
  getUserDigestSeenAt,
} from "./db";

// MissedDigestCard ("פעילות חדשה") — getDigestAnchor (lib/audit.ts) reads
// users.digest_seen_at first and only falls back to login history when it's
// null, so pinning it directly (setUserDigestSeenAt) makes the "since you
// were last here" window deterministic — this shared e2e-admin fixture logs
// in from many parallel specs, and its real login history is not something
// any single test can control. "customers" is a TRIGGER_AUDITED_TABLE
// (log_changes()), so a plain createTestCustomer (inserted via the
// service-role client, no auth.uid() in scope) generates a REAL audit_logs
// row with changed_by = NULL — which getMissedDigest's exclude-self filter
// never matches, so it always counts as missed. No hand-built audit_logs row
// needed. onDismiss calls the set_my_digest_seen_at RPC and advances the
// anchor to "now" — verified at the DB level, not just the card vanishing.
test.describe("admin — dashboard activity digest card", () => {
  test("admin sees a missed customer creation and can dismiss the digest", async ({ page }) => {
    test.setTimeout(60_000);
    const adminId = await getAdminUserId();
    const originalSeenAt = await getUserDigestSeenAt(adminId);
    const anchor = new Date(Date.now() - 60 * 60_000).toISOString();
    await setUserDigestSeenAt(adminId, anchor);
    const customer = await createTestCustomer({ name: `E2E missed customer ${Date.now()}` });
    try {
      await loginAs(page, "admin");

      const topicButton = page.getByRole("button", { name: /לקוח/ });
      await expect(topicButton).toBeVisible();
      await topicButton.click();
      await expect(page.getByText(customer.name)).toBeVisible();

      await page.getByRole("button", { name: "סימון כנקרא" }).click();
      await expect(topicButton).toBeHidden();

      await expect
        .poll(async () => {
          const seenAt = await getUserDigestSeenAt(adminId);
          return seenAt !== null && seenAt > anchor;
        })
        .toBe(true);
    } finally {
      await deleteTestCustomer(customer.id);
      await setUserDigestSeenAt(adminId, originalSeenAt);
    }
  });
});
