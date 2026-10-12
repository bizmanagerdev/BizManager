import { describe, expect, it } from "vitest";
import { downloadLinkTarget, downloadNameFor, fileDownloadHref, isStorageUrl, safeFileName } from "@/lib/file-download";

const SIGNED = "https://proj.supabase.co/storage/v1/object/sign/business-documents/a/b.pdf?token=abc.def-ghi_jkl";

describe("fileDownloadHref", () => {
  it("tells Storage to answer with the file as an attachment, under its name", () => {
    expect(fileDownloadHref(SIGNED, "contract.pdf")).toBe(`${SIGNED}&download=contract.pdf`);
  });

  it("keeps a Hebrew name and spaces exactly (encoded, never a +)", () => {
    expect(fileDownloadHref(SIGNED, "חוזה עבודה.pdf")).toBe(
      `${SIGNED}&download=${encodeURIComponent("חוזה עבודה.pdf")}`
    );
    expect(fileDownloadHref(SIGNED, "a b.pdf")).toContain("download=a%20b.pdf");
  });

  it("replaces a download it already carries, and keeps a hash", () => {
    expect(fileDownloadHref(`${SIGNED}&download=old.pdf#page=2`, "new.pdf")).toBe(`${SIGNED}&download=new.pdf#page=2`);
  });

  it("strips characters a file system refuses", () => {
    expect(fileDownloadHref(SIGNED, 'a/b:c?.pdf')).toContain(`download=${encodeURIComponent("a b c .pdf")}`);
  });

  it("leaves a link that isn't Storage alone", () => {
    expect(fileDownloadHref("blob:http://localhost/1", "x.pdf")).toBe("blob:http://localhost/1");
    expect(fileDownloadHref("https://example.com/x.pdf", "x.pdf")).toBe("https://example.com/x.pdf");
  });
});

describe("helpers", () => {
  it("knows a Storage link", () => {
    expect(isStorageUrl(SIGNED)).toBe(true);
    expect(isStorageUrl("https://proj.supabase.co/storage/v1/object/public/b/x.png")).toBe(true);
    expect(isStorageUrl("https://example.com/x.png")).toBe(false);
  });

  it("opens a non-Storage link elsewhere in its own tab, never in place of the app", () => {
    expect(downloadLinkTarget(SIGNED)).toBeUndefined();
    expect(downloadLinkTarget("blob:http://localhost/1")).toBeUndefined();
    expect(downloadLinkTarget("https://example.com/x.pdf")).toBe("_blank");
  });

  it("a name with no type of its own borrows the stored file's", () => {
    expect(downloadNameFor("צילום הצ׳ק", SIGNED)).toBe("צילום הצ׳ק.pdf");
    expect(downloadNameFor("contract.pdf", SIGNED)).toBe("contract.pdf");
    expect(downloadNameFor("חוזה", "https://proj.supabase.co/storage/v1/object/sign/b/x?token=t")).toBe("חוזה");
    expect(downloadNameFor("חוזה", null)).toBe("חוזה");
  });

  it("a safe name, with a fallback", () => {
    expect(safeFileName("  ")).toBe("BizH-file");
    expect(safeFileName('דו"ח: 10/26.pdf')).toBe("דו ח 10 26.pdf");
  });
});
