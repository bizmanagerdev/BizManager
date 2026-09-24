import { describe, it, expect } from "vitest";
import { describeMatch } from "@/lib/documents/suggestions";

describe("describeMatch", () => {
  const doc = {
    title: "IMG-20260914",
    file_name: "IMG-20260914-WA0026.jpg",
    document_type: "תעודת משלוח",
    customers: [{ label: "מוסדות דארג" }],
    projects: [],
    properties: [],
    tags: [],
  };

  it("names the field that matched when the title does not explain it", () => {
    expect(describeMatch(doc, "דארג")).toBe("לקוח: מוסדות דארג");
    expect(describeMatch(doc, "משלוח")).toBe("קטגוריה: תעודת משלוח");
  });

  it("stays quiet when the title already shows why", () => {
    expect(describeMatch(doc, "IMG-2026")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(describeMatch(doc, "  ")).toBeNull();
  });
});
