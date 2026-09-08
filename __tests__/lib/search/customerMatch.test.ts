import { describe, it, expect } from "vitest";
import {
  customerMatchesQuery,
  fuzzyTextMatch,
  normalizePhone,
  normalizeSearchText,
  osaDistance,
  phoneMatchesQuery,
  substringMatch,
} from "@/lib/search/customerMatch";

describe("normalizeSearchText", () => {
  it("folds final letters and strips punctuation/case", () => {
    expect(normalizeSearchText("ביאן")).toBe("ביאנ");
    expect(normalizeSearchText("שלום, עולם!")).toBe("שלומ עולמ");
    expect(normalizeSearchText("  ABC  ")).toBe("abc");
  });

  it("handles empty/nullish input", () => {
    expect(normalizeSearchText("")).toBe("");
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("normalizePhone", () => {
  it("keeps digits only", () => {
    expect(normalizePhone("050-123-4567")).toBe("0501234567");
    expect(normalizePhone("(050) 123 4567")).toBe("0501234567");
  });

  it("folds the Israeli country code to the local form", () => {
    expect(normalizePhone("+972-50-123-4567")).toBe("0501234567");
    expect(normalizePhone("00972501234567")).toBe("0501234567");
  });
});

describe("osaDistance", () => {
  it("treats an adjacent swap as a single edit", () => {
    expect(osaDistance("ביאנ", "באינ")).toBe(1);
    expect(osaDistance("abc", "abc")).toBe(0);
    expect(osaDistance("abc", "abd")).toBe(1);
  });
});

describe("fuzzyTextMatch", () => {
  it("matches substrings", () => {
    expect(fuzzyTextMatch("דוד ביאן", "ביאן")).toBe(true);
  });

  it("matches similar names with a letter swap (באין → ביאן)", () => {
    expect(fuzzyTextMatch("ביאן", "באין")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(fuzzyTextMatch("ישראל ישראלי", "כהן")).toBe(false);
  });
});

describe("phoneMatchesQuery", () => {
  it("cross-matches a number against both phone and whatsapp fields", () => {
    // number lives only in whatsapp, query is a partial phone string
    expect(phoneMatchesQuery([null, "050-123-4567"], "0501234567")).toBe(true);
    expect(phoneMatchesQuery(["050-123-4567", null], "+972501234567")).toBe(true);
  });

  it("ignores too-short numeric queries", () => {
    expect(phoneMatchesQuery(["0501234567"], "05")).toBe(false);
  });
});

describe("substringMatch", () => {
  it("matches normalized substrings only (no fuzz)", () => {
    expect(substringMatch("דוד@example.com", "example")).toBe(true);
    expect(substringMatch("דוד@example.com", "exampel")).toBe(false);
  });
});

describe("customerMatchesQuery", () => {
  it("matches by whatsapp when the query is a number not in the phone field", () => {
    expect(
      customerMatchesQuery({ name: "דוד", phone: null, whatsapp: "050-123-4567" }, "0501234567")
    ).toBe(true);
  });

  it("matches a misspelled name", () => {
    expect(customerMatchesQuery({ name: "ביאן" }, "באין")).toBe(true);
  });

  it("matches through a contact", () => {
    expect(
      customerMatchesQuery(
        { name: "חברה בעמ", contacts: [{ full_name: "משה כהן", whatsapp: "052-9999999" }] },
        "0529999999"
      )
    ).toBe(true);
  });

  it("returns false for a blank query", () => {
    expect(customerMatchesQuery({ name: "דוד" }, "   ")).toBe(false);
  });
});
