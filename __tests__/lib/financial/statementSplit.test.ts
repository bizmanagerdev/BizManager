import { describe, it, expect } from "vitest";
import { resolveSplit, validateSplitParts, type SplitPartDraft } from "@/lib/financial/statementSplit";

// ₪1,000 at the supermarket: ₪500 home, ₪340 sales, and the rest to שוטף.

const part = (domain: string, amount = ""): SplitPartDraft => ({ domain, amount, projectId: "", propertyId: "" });

describe("resolveSplit — the dialog's parts", () => {
  it("the last part takes what the others leave", () => {
    const { parts, remainder, error } = resolveSplit(1000, [
      part("home", "500"),
      part("sales", "340"),
      part("general_business"),
    ]);
    expect(error).toBeNull();
    expect(remainder).toBe(160);
    expect(parts.map((p) => [p.domain, p.amount])).toEqual([
      ["home", 500],
      ["sales", 340],
      ["general_business", 160],
    ]);
  });

  it("keeps agorot exact", () => {
    const { remainder } = resolveSplit(100.1, [part("home", "33.37"), part("sales")]);
    expect(remainder).toBe(66.73);
  });

  it("says what is missing", () => {
    expect(resolveSplit(1000, [part("home", "500")]).error).toMatch(/לפחות שני/);
    expect(resolveSplit(1000, [part("home", "500"), part("")]).error).toMatch(/תחום/);
    expect(resolveSplit(1000, [part("home", ""), part("sales")]).error).toMatch(/סכום/);
    expect(resolveSplit(1000, [part("home", "1000"), part("sales")]).error).toMatch(/עוברים/);
  });

  it("carries a project or property only for the domain that has one", () => {
    const { parts } = resolveSplit(100, [
      { domain: "logistics_projects", amount: "40", projectId: "p1", propertyId: "x" },
      { domain: "home", amount: "", projectId: "p2", propertyId: "" },
    ]);
    expect(parts[0]).toMatchObject({ projectId: "p1", propertyId: null });
    expect(parts[1]).toMatchObject({ projectId: null, propertyId: null });
  });
});

describe("validateSplitParts — the route's check", () => {
  const p = (domain: string, amount: number) => ({ domain, amount, projectId: null, propertyId: null });

  it("accepts parts that add up to the line exactly", () => {
    expect(validateSplitParts(1000, [p("home", 500), p("sales", 340), p("general_business", 160)])).toBeNull();
  });

  it("rejects a sum that misses by even an agora, a non-positive part, or an unknown domain", () => {
    expect(validateSplitParts(1000, [p("home", 500), p("sales", 499.99)])).toMatch(/מסתכמים/);
    expect(validateSplitParts(1000, [p("home", 1000), p("sales", 0)])).toMatch(/חיובי/);
    expect(validateSplitParts(1000, [p("home", 500), p("nope", 500)])).toMatch(/תחום/);
  });
});
