// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { highlightText, matchRanges, snippetAround } from "@/components/search/highlightMatch";

// The yellow paint must find what the search found — the same folding:
// final letters, quote marks inside a word, thousands commas, case.

afterEach(cleanup);

function painted(text: string, terms: string | string[]) {
  const { container } = render(<div>{highlightText(text, terms)}</div>);
  return Array.from(container.querySelectorAll("mark")).map((mark) => mark.textContent);
}

describe("matchRanges / highlightText", () => {
  it("a final letter matches its regular form", () => {
    expect(painted("משפחת כהנים", "כהן")).toEqual(["כהנ"]);
    expect(painted("יעקב כהן", "כהנ")).toEqual(["כהן"]);
  });

  it("quote marks inside a word are skipped and painted with it", () => {
    expect(painted("תשלום בצ׳ק", "צק")).toEqual(["צ׳ק"]);
    expect(painted('מק"ט 55', "מקט")).toEqual(['מק"ט']);
  });

  it("1000 finds 1,000", () => {
    expect(painted("₪1,000", "1000")).toEqual(["1,000"]);
  });

  it("case is ignored", () => {
    expect(painted("Dan@Gmail.com", "gmail")).toEqual(["Gmail"]);
  });

  it("an hour is painted whole, never as two numbers", () => {
    expect(painted("נמסרה 14:30", "14:30")).toEqual(["14:30"]);
    expect(painted("1430 ₪", "14:30")).toEqual([]);
  });

  it("a phrase is painted whole where it appears whole, else word by word", () => {
    expect(painted("משה כהן", "משה כהן")).toEqual(["משה כהן"]);
    expect(painted("כהן, משה", "משה כהן")).toEqual(["כהן", "משה"]);
  });

  it("every occurrence of every term, merged", () => {
    expect(painted("ביאן מרקט ביאן", ["ביאן", "מרקט"])).toEqual(["ביאן", "מרקט", "ביאן"]);
  });

  it("no match → the text unchanged", () => {
    expect(highlightText("שלום", "כהן")).toBe("שלום");
    expect(matchRanges("", "x")).toEqual([]);
  });
});

describe("snippetAround", () => {
  it("cuts a long note to a window around the match", () => {
    const long = `${"א".repeat(200)} ביאנקו ${"ב".repeat(200)}`;
    const snippet = snippetAround(long, "ביאנקו", 40);
    expect(snippet).toContain("ביאנקו");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });
});
