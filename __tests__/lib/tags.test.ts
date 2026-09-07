import { describe, it, expect } from "vitest";
import { parseTagIds } from "@/lib/tags";

describe("parseTagIds", () => {
  it("keeps only non-empty strings, de-duped", () => {
    expect(parseTagIds(["tag-1", "tag-2", "tag-1"])).toEqual(["tag-1", "tag-2"]);
  });
  it("drops non-string / empty entries", () => {
    expect(parseTagIds(["tag-1", "", 5, null, undefined, {}])).toEqual(["tag-1"]);
  });
  it("returns [] for anything that isn't an array", () => {
    expect(parseTagIds(null)).toEqual([]);
    expect(parseTagIds(undefined)).toEqual([]);
    expect(parseTagIds("tag-1")).toEqual([]);
    expect(parseTagIds({ tag_ids: ["tag-1"] })).toEqual([]);
  });
});
