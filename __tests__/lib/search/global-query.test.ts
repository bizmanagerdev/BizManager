import { describe, it, expect } from "vitest";
import { fuzzyAlternatives, gsNorm, parseGlobalQuery, phoneDigits } from "@/lib/search/global-query";

const TODAY = "2026-10-18";

describe("gsNorm", () => {
  it("folds final letters, drops quote marks, lower-cases", () => {
    expect(gsNorm("כהן")).toBe("כהנ");
    expect(gsNorm("צ׳ק")).toBe("צק");
    expect(gsNorm("מק\"ט")).toBe("מקט");
    expect(gsNorm("Dan@Gmail.com")).toBe("dan gmail com");
  });
});

describe("phoneDigits", () => {
  it("folds +972 to a leading 0", () => {
    expect(phoneDigits("+972-54-893-3553")).toBe("0548933553");
    expect(phoneDigits("00972548933553")).toBe("0548933553");
    expect(phoneDigits("054-893-3553")).toBe("0548933553");
  });
});

describe("parseGlobalQuery", () => {
  it("an amount in any form", () => {
    for (const typed of ["1000", "1,000", "₪1,000", "1000 ש\"ח", "1000 שקל"]) {
      const parsed = parseGlobalQuery(typed, TODAY);
      expect(parsed.tokens).toEqual([{ a: 1000, w: true, t: ["1000"] }]);
      expect(parsed.understood).toEqual([{ kind: "amount", value: "1000" }]);
    }
  });

  it("a decimal amount is matched as an amount only", () => {
    expect(parseGlobalQuery("2,997.75", TODAY).tokens).toEqual([{ a: 2997.75, w: true }]);
  });

  it("a date with or without a year (no year = this year)", () => {
    expect(parseGlobalQuery("15/10", TODAY).tokens).toEqual([{ d: "2026-10-15" }]);
    expect(parseGlobalQuery("15.10.26", TODAY).tokens).toEqual([{ d: "2026-10-15" }]);
    expect(parseGlobalQuery("15-10-2026", TODAY).tokens).toEqual([{ d: "2026-10-15" }]);
    expect(parseGlobalQuery("2026-10-15", TODAY).tokens).toEqual([{ d: "2026-10-15" }]);
  });

  it("1.5 is a date AND an amount", () => {
    expect(parseGlobalQuery("1.5", TODAY).tokens).toEqual([{ d: "2026-05-01", a: 1.5 }]);
  });

  it("not a real day → not a date", () => {
    const tokens = parseGlobalQuery("31/02", TODAY).tokens;
    expect(tokens.some((token) => token.d)).toBe(false);
  });

  it("an hour", () => {
    expect(parseGlobalQuery("14:30", TODAY).tokens).toEqual([{ h: "14:30" }]);
    expect(parseGlobalQuery("9:05", TODAY).tokens).toEqual([{ h: "09:05" }]);
    expect(parseGlobalQuery("14:30", TODAY).understood).toEqual([{ kind: "hour", value: "14:30" }]);
  });

  it("not a real hour → not an hour", () => {
    expect(parseGlobalQuery("25:00", TODAY).tokens.some((token) => token.h)).toBe(false);
    expect(parseGlobalQuery("14:75", TODAY).tokens.some((token) => token.h)).toBe(false);
  });

  it("a date and an hour together", () => {
    expect(parseGlobalQuery("15/10 14:30", TODAY).tokens).toEqual([{ d: "2026-10-15" }, { h: "14:30" }]);
  });

  it("a phone, typed with spaces or dashes", () => {
    expect(parseGlobalQuery("054 893 3553", TODAY).tokens).toEqual([{ t: ["0548933553"], p: "0548933553" }]);
    expect(parseGlobalQuery("+972-54-8933553", TODAY).tokens).toEqual([{ t: ["0548933553"], p: "0548933553" }]);
    expect(parseGlobalQuery("0548933553", TODAY).tokens).toEqual([{ t: ["0548933553"], p: "0548933553" }]);
  });

  it("the start of a phone is a phone piece, not an amount", () => {
    expect(parseGlobalQuery("050", TODAY).tokens).toEqual([{ t: ["050"], p: "050" }]);
  });

  it("a long number may also be part of a phone / plate / account", () => {
    expect(parseGlobalQuery("12345", TODAY).tokens).toEqual([{ a: 12345, w: true, t: ["12345"], p: "12345" }]);
  });

  it("words: every one becomes its own token", () => {
    const parsed = parseGlobalQuery("משה כהן", TODAY);
    expect(parsed.tokens).toEqual([{ t: ["משה"] }, { t: ["כהנ"] }]);
    expect(parsed.words).toEqual(["משה", "כהנ"]);
  });

  it("words and an amount together narrow each other", () => {
    expect(parseGlobalQuery("1000 חשמל", TODAY).tokens).toEqual([{ a: 1000, w: true, t: ["1000"] }, { t: ["חשמל"] }]);
  });

  it("a date and a word together", () => {
    expect(parseGlobalQuery("15/10 משכנתא", TODAY).tokens).toEqual([{ d: "2026-10-15" }, { t: ["משכנתא"] }]);
  });

  it("drops a lone letter when there's more to search for", () => {
    expect(parseGlobalQuery("ב כהן", TODAY).tokens).toEqual([{ t: ["כהנ"] }]);
  });

  it("only the first three amounts/dates/phones are matched as such", () => {
    const tokens = parseGlobalQuery("100 200 300 400", TODAY).tokens;
    expect(tokens.filter((token) => token.a !== undefined)).toHaveLength(3);
    expect(tokens[3]).toEqual({ t: ["400"], w: true });
  });

  it("nothing typed → nothing to search", () => {
    expect(parseGlobalQuery("   ", TODAY).tokens).toEqual([]);
  });
});

describe("fuzzyAlternatives", () => {
  const vocabulary = ["ביאנ", "מרקט", "ביאנקו", "חשמל", "משכנתא", "הובלה", "כהנ"];

  it("a swapped pair of letters finds the real word", () => {
    expect(fuzzyAlternatives("באינ", vocabulary)).toContain("ביאנ");
  });

  it("a slip in a half-typed word finds the start of the real one", () => {
    expect(fuzzyAlternatives("משכנט", vocabulary)).toContain("משכנת");
  });

  it("nothing to fix when the word exists as typed", () => {
    expect(fuzzyAlternatives("חשמל", vocabulary)).toEqual([]);
    expect(fuzzyAlternatives("חשמ", vocabulary)).toEqual([]);
  });

  it("a word that only appears inside a longer one still gets the close whole word", () => {
    expect(fuzzyAlternatives("באינ", ["באינטרנט", "ביאנ"])).toEqual(["ביאנ"]);
  });

  it("short words and numbers aren't 'corrected'", () => {
    expect(fuzzyAlternatives("כה", vocabulary)).toEqual([]);
    expect(fuzzyAlternatives("1000", vocabulary)).toEqual([]);
  });

  it("a three-letter word only matches the same letters reordered", () => {
    expect(fuzzyAlternatives("כנה", vocabulary)).toEqual(["כהנ"]);
    expect(fuzzyAlternatives("כהב", vocabulary)).toEqual([]);
  });
});
