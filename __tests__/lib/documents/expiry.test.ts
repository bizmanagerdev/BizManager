import { describe, it, expect } from "vitest";
import {
  daysBetweenIsoDates,
  expiryBadgeTone,
  expiryLabel,
  getExpiryStatus,
  supersededDocumentIds,
} from "@/lib/documents/expiry";
import { daysHe, documentsHe, pluralHe } from "@/lib/i18n/pluralHe";

const TODAY = "2026-09-24";
const LEAD = 30;

describe("getExpiryStatus — the boundaries", () => {
  it("yesterday is expired", () => {
    const result = getExpiryStatus("2026-09-23", LEAD, false, TODAY);
    expect(result.status).toBe("expired");
    expect(result.daysLeft).toBe(-1);
  });

  it("today is its own state, not expired", () => {
    // A licence that runs out today is still usable today, and saying "פג תוקף"
    // about it would send someone chasing a renewal a day early.
    const result = getExpiryStatus(TODAY, LEAD, false, TODAY);
    expect(result.status).toBe("today");
    expect(result.daysLeft).toBe(0);
  });

  it("the last day of the lead window still warns", () => {
    const result = getExpiryStatus("2026-10-24", LEAD, false, TODAY);
    expect(result.status).toBe("soon");
    expect(result.daysLeft).toBe(30);
  });

  it("one day past the lead window is simply valid", () => {
    const result = getExpiryStatus("2026-10-25", LEAD, false, TODAY);
    expect(result.status).toBe("valid");
    expect(result.daysLeft).toBe(31);
  });

  it("no date means the date is missing, not that it is fine", () => {
    expect(getExpiryStatus(null, LEAD, false, TODAY).status).toBe("missing");
    expect(getExpiryStatus("", LEAD, false, TODAY).status).toBe("missing");
    expect(getExpiryStatus("not a date", LEAD, false, TODAY).status).toBe("missing");
  });

  it("superseded beats every other answer", () => {
    // Last year's insurance has expired and nobody needs telling.
    expect(getExpiryStatus("2025-01-01", LEAD, true, TODAY).status).toBe("superseded");
    expect(getExpiryStatus("2026-10-01", LEAD, true, TODAY).status).toBe("superseded");
    expect(getExpiryStatus(null, LEAD, true, TODAY).status).toBe("superseded");
  });

  it("respects a category's own lead time", () => {
    // 2026-10-01 is 7 days out: inside a 7-day window, outside a 6-day one.
    expect(getExpiryStatus("2026-10-01", 7, false, TODAY).status).toBe("soon");
    expect(getExpiryStatus("2026-10-01", 6, false, TODAY).status).toBe("valid");
    expect(getExpiryStatus("2026-11-20", 60, false, TODAY).status).toBe("soon");
  });

  it("counts days across a month end and a leap year", () => {
    expect(daysBetweenIsoDates("2026-09-24", "2026-10-01")).toBe(7);
    expect(daysBetweenIsoDates("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("expiryLabel and tone", () => {
  it("says the count the way Hebrew says it", () => {
    expect(expiryLabel(getExpiryStatus("2026-09-25", LEAD, false, TODAY))).toBe("עוד יום אחד");
    expect(expiryLabel(getExpiryStatus("2026-09-26", LEAD, false, TODAY))).toBe("עוד יומיים");
    expect(expiryLabel(getExpiryStatus("2026-09-29", LEAD, false, TODAY))).toBe("עוד 5 ימים");
  });

  it("names the states that need naming and stays quiet on the rest", () => {
    expect(expiryLabel({ status: "expired", daysLeft: -3 })).toBe("פג תוקף");
    expect(expiryLabel({ status: "today", daysLeft: 0 })).toBe("פג היום");
    expect(expiryLabel({ status: "superseded", daysLeft: null })).toBe("הוחלף");
    expect(expiryLabel({ status: "valid", daysLeft: 90 })).toBeNull();
  });

  it("gives a badge only to what a person must act on", () => {
    expect(expiryBadgeTone("expired")).toBe("destructive");
    expect(expiryBadgeTone("today")).toBe("destructive");
    expect(expiryBadgeTone("soon")).toBe("warning");
    expect(expiryBadgeTone("valid")).toBeNull();
    expect(expiryBadgeTone("superseded")).toBeNull();
    expect(expiryBadgeTone("missing")).toBeNull();
  });
});

describe("supersededDocumentIds", () => {
  const doc = (id: string, category: string, validUntil: string | null, entityKey: string) => ({
    id,
    category,
    validUntil,
    entityKey,
  });

  it("keeps the latest of a kind and retires the rest", () => {
    const result = supersededDocumentIds([
      doc("old", "ביטוח", "2025-12-31", "vehicle-1"),
      doc("new", "ביטוח", "2026-12-31", "vehicle-1"),
    ]);
    expect(result.has("old")).toBe(true);
    expect(result.has("new")).toBe(false);
  });

  it("does not let one thing supersede another thing's document", () => {
    const result = supersededDocumentIds([
      doc("a", "ביטוח", "2025-12-31", "vehicle-1"),
      doc("b", "ביטוח", "2026-12-31", "vehicle-2"),
    ]);
    expect(result.size).toBe(0);
  });

  it("does not let one category supersede another", () => {
    const result = supersededDocumentIds([
      doc("licence", "תעודה/רישיון", "2025-12-31", "vehicle-1"),
      doc("insurance", "ביטוח", "2026-12-31", "vehicle-1"),
    ]);
    expect(result.size).toBe(0);
  });

  it("never supersedes an unfiled document", () => {
    // Two loose insurance papers are not known to concern the same car, so
    // retiring one on the strength of the other's date would be a guess.
    const result = supersededDocumentIds([
      doc("a", "ביטוח", "2025-12-31", ""),
      doc("b", "ביטוח", "2026-12-31", ""),
    ]);
    expect(result.size).toBe(0);
  });

  it("leaves a document with no date alone — it still needs one", () => {
    const result = supersededDocumentIds([
      doc("undated", "ביטוח", null, "vehicle-1"),
      doc("dated", "ביטוח", "2026-12-31", "vehicle-1"),
    ]);
    expect(result.has("undated")).toBe(false);
  });

  it("treats a tie as two current documents", () => {
    const result = supersededDocumentIds([
      doc("a", "ביטוח", "2026-12-31", "vehicle-1"),
      doc("b", "ביטוח", "2026-12-31", "vehicle-1"),
    ]);
    expect(result.size).toBe(0);
  });
});

describe("pluralHe", () => {
  it("uses the dual", () => {
    expect(daysHe(1)).toBe("יום אחד");
    expect(daysHe(2)).toBe("יומיים");
    expect(daysHe(5)).toBe("5 ימים");
    expect(daysHe(20)).toBe("20 ימים");
  });

  it("never writes 1 מסמכים", () => {
    expect(documentsHe(1)).toBe("מסמך אחד");
    expect(documentsHe(2)).toBe("2 מסמכים");
    expect(documentsHe(119)).toBe("119 מסמכים");
  });

  it("ignores a sign or a fraction", () => {
    expect(pluralHe(-1, { one: "א", two: "ב", many: "ג" })).toBe("א");
    expect(pluralHe(2.7, { one: "א", two: "ב", many: "ג" })).toBe("ב");
  });
});
