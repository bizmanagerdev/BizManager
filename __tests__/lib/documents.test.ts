import { describe, it, expect } from "vitest";
import {
  isDocumentCategory,
  getDocumentCategoryLabel,
  inferDefaultDocumentCategory,
  DEFAULT_DOCUMENT_CATEGORY,
} from "@/lib/documents";

describe("isDocumentCategory", () => {
  it("accepts a value from the controlled list", () => {
    expect(isDocumentCategory("חשבונית")).toBe(true);
  });
  it("rejects free text, null, and undefined", () => {
    expect(isDocumentCategory("משהו אחר")).toBe(false);
    expect(isDocumentCategory(null)).toBe(false);
    expect(isDocumentCategory(undefined)).toBe(false);
  });
});

describe("getDocumentCategoryLabel", () => {
  it("translates a system-generated code to Hebrew", () => {
    expect(getDocumentCategoryLabel("order_delivery_image")).toBe("צילום משלוח");
    expect(getDocumentCategoryLabel("card_statement")).toBe("דף חיוב אשראי");
  });
  it("translates a Morning document type id", () => {
    expect(getDocumentCategoryLabel("morning_305")).toBe("חשבונית מס");
    expect(getDocumentCategoryLabel("morning_999")).toBe("מסמך מורנינג"); // unknown id, generic fallback
  });
  it("passes a controlled Hebrew value straight through", () => {
    expect(getDocumentCategoryLabel("קבלה")).toBe("קבלה");
  });
  it("passes free text straight through (not a controlled/system value)", () => {
    expect(getDocumentCategoryLabel("משהו שהמשתמש כתב")).toBe("משהו שהמשתמש כתב");
  });
  it("shows a placeholder for empty/null/whitespace", () => {
    expect(getDocumentCategoryLabel(null)).toBe("ללא קטגוריה");
    expect(getDocumentCategoryLabel(undefined)).toBe("ללא קטגוריה");
    expect(getDocumentCategoryLabel("   ")).toBe("ללא קטגוריה");
  });
});

describe("inferDefaultDocumentCategory", () => {
  it("defaults an image file to צילום", () => {
    for (const name of ["photo.jpg", "scan.PNG", "shot.heic"]) {
      expect(inferDefaultDocumentCategory(name)).toBe("צילום");
    }
  });
  it("defaults anything else (pdf, no extension, unset) to the generic category", () => {
    expect(inferDefaultDocumentCategory("invoice.pdf")).toBe(DEFAULT_DOCUMENT_CATEGORY);
    expect(inferDefaultDocumentCategory("no-extension")).toBe(DEFAULT_DOCUMENT_CATEGORY);
    expect(inferDefaultDocumentCategory(null)).toBe(DEFAULT_DOCUMENT_CATEGORY);
    expect(inferDefaultDocumentCategory(undefined)).toBe(DEFAULT_DOCUMENT_CATEGORY);
  });
});
