import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { deleteTestDocument, getDocumentFile } from "./db";

// UploadDocumentDialog (components/documents/UploadDocumentDialog.tsx) is
// the ONE upload form shared by the archive page and the quick-create menu.
// general_business ("שוטף") is the cheapest path: pickDomain jumps straight
// to category (skipping the optional customer step), "ללא קטגוריה" tracks no
// expiry so it jumps to tags, tags is optional ("המשך"), then files, then
// the summary's "העלאה". The hidden <input type="file">
// (file-upload-actions.tsx) takes Playwright's in-memory file directly.
//
// These are OptionRow auto-advance steps — the same pattern that raced in
// admin-recurring-expense.spec.ts — so each step's own heading is awaited
// before interacting with it.
//
// Storage is off in the local stack by default; CI turns it on and creates
// the business-documents bucket plus a staff policy for this test (see
// .github/workflows/ci.yml). The route uploads with the user's own session,
// so that policy is what lets the upload through.
test.describe("admin — documents archive", () => {
  test("admin can upload a document", async ({ page }) => {
    test.setTimeout(60_000);
    const fileName = `E2E doc ${Date.now()}.txt`;
    let documentId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/documents");

      await page.getByRole("button", { name: "העלאת קבצים" }).first().click();

      await expect(page.getByText("לאיזה תחום שייך המסמך?")).toBeVisible();
      await page.getByRole("button", { name: "שוטף" }).click();

      await expect(page.getByText("איזו קטגוריה?")).toBeVisible();
      await page.getByRole("button", { name: "ללא קטגוריה" }).click();

      await expect(page.getByText("לשייך תגיות?")).toBeVisible();
      await page.getByRole("button", { name: "המשך" }).click();

      await expect(page.getByText("אילו קבצים להעלות?")).toBeVisible();
      await page
        .getByRole("dialog")
        .locator('input[type="file"]')
        .setInputFiles({
          name: fileName,
          mimeType: "text/plain",
          buffer: Buffer.from("E2E test document contents"),
        });
      await page.getByRole("button", { name: "המשך" }).click();

      await expect(page.getByText("לאשר ולהעלות?")).toBeVisible();
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

      const stored = await getDocumentFile(documentId!);
      expect(stored?.file_name).toBe(fileName);
      expect(stored?.storage_key).toBeTruthy();
    } finally {
      if (documentId) await deleteTestDocument(documentId);
    }
  });
});
