import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { deleteTestDocument } from "./db";

// UploadDocumentDialog (components/documents/UploadDocumentDialog.tsx) is
// the ONE upload form shared by the archive page and the quick-create menu
// — no dedicated e2e coverage existed for the actual file-upload path
// itself (only createTestDocument's direct DB insert, used elsewhere to
// seed a document for OTHER tests to find). general_business (domain:
// "שוטף") is the cheapest path: domain and category both auto-advance
// (pickDomain/pickCategory), "tags" is optional with no auto-advance but
// isSatisfied returns true unconditionally so "המשך" is enabled without
// picking any, and refYear only appears once a tag IS picked — skipped
// here. The hidden <input type="file"> (file-upload-actions.tsx) takes
// Playwright's in-memory file object directly, no fixture file on disk
// needed.
test.describe("admin — documents archive", () => {
  test("admin can upload a document and see it in the archive", async ({ page }) => {
    test.setTimeout(60_000);
    const fileName = `E2E doc ${Date.now()}.txt`;
    let documentId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/documents");

      await page.getByRole("button", { name: "העלאת קבצים" }).click();

      // domain: "שוטף" (general_business) — auto-advances to category.
      await page.getByRole("button", { name: "שוטף" }).click();
      // category: none — auto-advances to tags.
      await page.getByRole("button", { name: "ללא קטגוריה" }).click();
      // tags (optional, no auto-advance) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();

      // files: the visible "בחר קבצים" button just opens this hidden input —
      // scoped to the dialog in case anything else on the page has its own
      // file input.
      await page
        .getByRole("dialog")
        .locator('input[type="file"]')
        .setInputFiles({
          name: fileName,
          mimeType: "text/plain",
          buffer: Buffer.from("E2E test document contents"),
        });
      await page.getByRole("button", { name: "המשך" }).click();

      // review — final submit.
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/documents/upload") && r.request().method() === "POST"),
        page.getByRole("button", { name: "העלאה" }).click(),
      ]);
      if (!response.ok()) {
        const errBody = await response.json().catch(() => null);
        throw new Error(`UPLOAD FAILED status=${response.status()} body=${JSON.stringify(errBody)}`);
      }
      const body = (await response.json()) as { document?: { id?: string; file_name?: string } };
      documentId = body.document?.id ?? null;
      expect(documentId).toBeTruthy();
      expect(body.document?.file_name).toBe(fileName);

      await expect(page.getByText(fileName)).toBeVisible();
    } finally {
      if (documentId) await deleteTestDocument(documentId);
    }
  });
});
