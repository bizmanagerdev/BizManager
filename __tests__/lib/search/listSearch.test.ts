import { describe, expect, it } from "vitest";
import { hourOf, matchSearchRecord, prepareListSearch, searchList, type SearchRecord } from "@/lib/search/listSearch";

// A list on screen is searched by the global search's rules: words (folded,
// misspellings), amounts, dates, hours and phones — each match says why.

const TODAY = "2026-10-19";

function match(record: SearchRecord, query: string) {
  const search = prepareListSearch(query, { today: TODAY });
  if (!search) throw new Error("empty query");
  return matchSearchRecord(record, search);
}

const bankLine: SearchRecord = {
  text: [
    [null, "חיוב כרטיס ישראכרט"],
    ["הערה", "תשלום לספק הובלות"],
    ["שעת רישום", "14:30"],
  ],
  amounts: [[null, 1447]],
  dates: [
    [null, "2026-10-15"],
    ["נרשם", "2026-10-12T11:32:00Z"],
  ],
  phones: [["טלפון לקוח", "+972 50-123-4567"]],
};

describe("matchSearchRecord", () => {
  it("an amount finds the row by its figure, typed any way", () => {
    expect(match(bankLine, "1447")).toEqual([]);
    expect(match(bankLine, "₪1,447")).toEqual([]);
    expect(match(bankLine, "1447 ש״ח")).toEqual([]);
    expect(match(bankLine, "1448")).toBeNull();
    // 144 is not inside 1447
    expect(match(bankLine, "144")).toBeNull();
  });

  it("a row in dollars: by its dollars (in $ or with no currency) and by its shekels (in ₪)", () => {
    const chase: SearchRecord = { text: [[null, "Chase"]], amounts: [[null, 3107], [null, 1000, "USD"]] };
    expect(match(chase, "1000")).toEqual([]);
    expect(match(chase, "$1,000")).toEqual([]);
    expect(match(chase, "1000 דולר")).toEqual([]);
    expect(match(chase, "C$1,000")).toBeNull();
    expect(match(chase, "₪1,000")).toBeNull();
    expect(match(chase, "₪3,107")).toEqual([]);
    expect(match(chase, "$3,107")).toBeNull();
    // Shown when it's not on the row: in its currency.
    expect(match({ text: [[null, "Chase"]], amounts: [["סכום בדולרים", 1000, "USD"]] }, "1000")).toEqual([
      { kind: "amount", label: "סכום בדולרים", value: "$1,000" },
    ]);
  });

  it("a date finds the row by any of its days, and says which one when the row doesn't show it", () => {
    expect(match(bankLine, "15/10")).toEqual([]);
    expect(match(bankLine, "12.10.26")).toEqual([{ kind: "date", label: "נרשם", value: "12/10/26" }]);
    expect(match(bankLine, "13/10")).toBeNull();
  });

  it("a word in a field the row doesn't show comes back as the reason", () => {
    expect(match(bankLine, "הובלות")).toEqual([{ kind: "text", label: "הערה", value: "תשלום לספק הובלות" }]);
    expect(match(bankLine, "ישראכרט")).toEqual([]);
  });

  it("every word must be found", () => {
    expect(match(bankLine, "ישראכרט הובלות")).toEqual([{ kind: "text", label: "הערה", value: "תשלום לספק הובלות" }]);
    expect(match(bankLine, "ישראכרט מכולת")).toBeNull();
  });

  it("an hour", () => {
    expect(match(bankLine, "14:30")).toEqual([{ kind: "text", label: "שעת רישום", value: "14:30" }]);
    expect(match(bankLine, "14:31")).toBeNull();
  });

  it("a phone with dashes, spaces or +972 finds the number however it was saved", () => {
    const reason = [{ kind: "phone", label: "טלפון לקוח", value: "+972 50-123-4567" }];
    expect(match(bankLine, "050-1234567")).toEqual(reason);
    expect(match(bankLine, "0501234567")).toEqual(reason);
    expect(match(bankLine, "050 123 4567")).toEqual(reason);
    expect(match({ phones: [[null, "0501234567"]] }, "050-123-4567")).toEqual([]);
  });

  it("final letters and quote marks are folded", () => {
    expect(match({ text: [[null, "תשלום בצ׳ק"]] }, "צק")).toEqual([]);
    expect(match({ text: [[null, "משפחת כהנים"]] }, "כהן")).toEqual([]);
  });

  it("a number in the words also counts as the amount (an order number, a reference)", () => {
    expect(match({ text: [["אסמכתא", "העברה 1447"]] }, "1447")).toEqual([
      { kind: "text", label: "אסמכתא", value: "העברה 1447" },
    ]);
  });
});

describe("searchList", () => {
  const rows = [
    { id: "a", label: "ביאן מרקט", amount: 120 },
    { id: "b", label: "סופר פארם", amount: 1447 },
    { id: "c", label: "ביאן מרקט", amount: 1447 },
  ];
  const toRecord = (row: (typeof rows)[number]): SearchRecord => ({ text: [[null, row.label]], amounts: [[null, row.amount]] });

  it("keeps the list's own order", () => {
    const result = searchList(rows, toRecord, "1447", { today: TODAY });
    expect(result?.items.map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("a misspelt word finds the word it stands for, and paints it", () => {
    const result = searchList(rows, toRecord, "באין", { today: TODAY });
    expect(result?.items.map((row) => row.id)).toEqual(["a", "c"]);
    expect(result?.search.corrections).toEqual(["ביאנ"]);
    expect(result?.search.terms).toContain("ביאנ");
  });

  it("nothing typed → no search", () => {
    expect(searchList(rows, toRecord, "  ")).toBeNull();
  });
});

describe("hourOf", () => {
  it("an instant's hour on Israel's clock; a bare day has none", () => {
    expect(hourOf("2026-10-12T11:32:00Z")).toBe("14:32");
    expect(hourOf("2026-10-12")).toBeNull();
    expect(hourOf(null)).toBeNull();
  });
});
