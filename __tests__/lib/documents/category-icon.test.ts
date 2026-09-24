import { describe, it, expect } from "vitest";
import { categoryIcon, FALLBACK_DOCUMENT_CATEGORIES } from "@/lib/documents/categories";

// The glyph comes from what the admin said the category DOES, so a category
// added later is not stuck with a generic file icon.
describe("categoryIcon", () => {
  const rows = FALLBACK_DOCUMENT_CATEGORIES;

  it("reads the behaviour flags, in priority order", () => {
    expect(categoryIcon(rows, "צילום")).toBe("camera");
    expect(categoryIcon(rows, "קבלה")).toBe("money");
    expect(categoryIcon(rows, "ביטוח")).toBe("expiry");
    expect(categoryIcon(rows, "מסמך כללי")).toBe("document");
  });

  it("still recognises the system codes that never became registry rows", () => {
    // The archive is mostly these; a wall of file glyphs would say nothing.
    expect(categoryIcon(rows, "order_delivery_image")).toBe("camera");
    expect(categoryIcon(rows, "vehicle_photo")).toBe("camera");
    expect(categoryIcon(rows, "card_statement")).toBe("money");
  });

  it("falls back to a plain document for anything unknown or empty", () => {
    expect(categoryIcon(rows, "משהו אחר לגמרי")).toBe("document");
    expect(categoryIcon(rows, "")).toBe("document");
    expect(categoryIcon(rows, null)).toBe("document");
  });

  it("prefers a registry row over the name-shaped guess", () => {
    const custom = [
      { ...rows[0]!, code: "צילום רנטגן", is_photo: false, is_money_doc: true },
    ];
    expect(categoryIcon(custom, "צילום רנטגן")).toBe("money");
  });
});
