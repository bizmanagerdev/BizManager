import { describe, it, expect } from "vitest";
import { projectTypesMatching } from "@/lib/search/projectTypeLabels";

describe("projectTypesMatching", () => {
  it("matches by the Hebrew label", () => {
    expect(projectTypesMatching("הובלה")).toEqual(["moving"]);
  });
  it("matches by the raw enum value too", () => {
    expect(projectTypesMatching("constr")).toEqual(["construction"]);
  });
  it("matches a partial substring of the label", () => {
    expect(projectTypesMatching("שיפוצ")).toEqual(["construction"]);
  });
  it("returns [] for an empty/whitespace query", () => {
    expect(projectTypesMatching("")).toEqual([]);
    expect(projectTypesMatching("   ")).toEqual([]);
  });
  it("returns [] when nothing matches", () => {
    expect(projectTypesMatching("xyz-nonexistent")).toEqual([]);
  });
});
