import { describe, it, expect } from "vitest";
import {
  formatShortDate,
  formatShortDateTime,
  formatTimeOnly,
  getDueUrgency,
  dueUrgencyChipClass,
  dueUrgencyTextClass,
  formatRelativeDateLabel,
} from "@/lib/date";

describe("formatShortDate", () => {
  it("renders a date-only string as DD/MM/YY, 2-digit year", () => {
    expect(formatShortDate("2026-01-05")).toBe("05/01/26");
  });
  it("a date-only string is parsed as LOCAL midnight, never shifted by UTC parsing (the classic off-by-one bug)", () => {
    // "2026-01-01" naively parsed via `new Date("2026-01-01")` is UTC midnight,
    // which renders as 31/12/25 in any timezone west of UTC — this must not happen.
    expect(formatShortDate("2026-01-01")).toBe("01/01/26");
  });
  it("also accepts a full ISO timestamp", () => {
    expect(formatShortDate("2026-06-15T10:30:00Z")).toMatch(/^15\/06\/26$/);
  });
  it("falls back to '-' by default for null/undefined/empty", () => {
    expect(formatShortDate(null)).toBe("-");
    expect(formatShortDate(undefined)).toBe("-");
    expect(formatShortDate("")).toBe("-");
  });
  it("a custom fallback is honored", () => {
    expect(formatShortDate(null, "—")).toBe("—");
  });
  it("an unparseable string is returned AS-IS, not silently swallowed", () => {
    expect(formatShortDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatShortDateTime", () => {
  it("appends HH:MM after the short date", () => {
    expect(formatShortDateTime("2026-01-05T14:30:00")).toBe("05/01/26 14:30");
  });
  it("falls back to '-' for null", () => {
    expect(formatShortDateTime(null)).toBe("-");
  });
});

describe("formatTimeOnly", () => {
  it("renders just HH:MM", () => {
    expect(formatTimeOnly("2026-01-05T08:05:00")).toBe("08:05");
  });
  it("falls back to '-' for null", () => {
    expect(formatTimeOnly(null)).toBe("-");
  });
});

describe("getDueUrgency", () => {
  const TODAY = "2026-06-15";

  it("overdue: any date before today", () => {
    expect(getDueUrgency("2026-06-14", { refDate: TODAY })).toBe("overdue");
  });
  it("due-soon: today through 3 days out (inclusive)", () => {
    expect(getDueUrgency("2026-06-15", { refDate: TODAY })).toBe("due-soon"); // today
    expect(getDueUrgency("2026-06-18", { refDate: TODAY })).toBe("due-soon"); // +3
  });
  it("due-week: 4 through 7 days out", () => {
    expect(getDueUrgency("2026-06-19", { refDate: TODAY })).toBe("due-week"); // +4
    expect(getDueUrgency("2026-06-22", { refDate: TODAY })).toBe("due-week"); // +7
  });
  it("none: further than a week out", () => {
    expect(getDueUrgency("2026-06-23", { refDate: TODAY })).toBe("none"); // +8
  });
  it("none: a done item is never urgent, even if overdue", () => {
    expect(getDueUrgency("2026-01-01", { done: true, refDate: TODAY })).toBe("none");
  });
  it("none: no date, or an unparseable one", () => {
    expect(getDueUrgency(null, { refDate: TODAY })).toBe("none");
    expect(getDueUrgency("not-a-date", { refDate: TODAY })).toBe("none");
  });
});

describe("dueUrgencyChipClass / dueUrgencyTextClass", () => {
  it("overdue and due-soon share the destructive (red) styling", () => {
    expect(dueUrgencyChipClass("overdue")).toBe(dueUrgencyChipClass("due-soon"));
    expect(dueUrgencyTextClass("overdue")).toBe(dueUrgencyTextClass("due-soon"));
  });
  it("due-week gets its own (warning) styling, distinct from overdue", () => {
    expect(dueUrgencyChipClass("due-week")).not.toBe(dueUrgencyChipClass("overdue"));
  });
  it("'none' renders no chip/text class at all — plain text, not a coincidentally-empty color", () => {
    expect(dueUrgencyChipClass("none")).toBe("");
    expect(dueUrgencyTextClass("none")).toBe("");
  });
});

describe("formatRelativeDateLabel", () => {
  const TODAY = "2026-06-15";

  it("today / yesterday / tomorrow get their own words, not '0/1 days'", () => {
    expect(formatRelativeDateLabel("2026-06-15", "-", TODAY)).toBe("היום");
    expect(formatRelativeDateLabel("2026-06-14", "-", TODAY)).toBe("אתמול");
    expect(formatRelativeDateLabel("2026-06-16", "-", TODAY)).toBe("מחר");
  });
  it("within a week (but not yesterday/tomorrow): 'X ימים'", () => {
    expect(formatRelativeDateLabel("2026-06-18", "-", TODAY)).toBe("בעוד 3 ימים");
    expect(formatRelativeDateLabel("2026-06-10", "-", TODAY)).toBe("לפני 5 ימים");
  });
  it("within a month: rounds to whole weeks", () => {
    expect(formatRelativeDateLabel("2026-06-29", "-", TODAY)).toBe("בעוד 2 שבועות"); // 14 days
    expect(formatRelativeDateLabel("2026-05-25", "-", TODAY)).toBe("לפני 3 שבועות"); // 21 days
  });
  it("a month or further out: rounds to whole months", () => {
    expect(formatRelativeDateLabel("2026-08-15", "-", TODAY)).toBe("בעוד 2 חודשים"); // ~61 days
  });
  it("falls back for null/unparseable input", () => {
    expect(formatRelativeDateLabel(null, "-", TODAY)).toBe("-");
    expect(formatRelativeDateLabel("garbage", "-", TODAY)).toBe("-");
  });
});

/**
 * Read from abroad, a shift has to show the hour the OFFICE keeps. A worker's
 * phone in New York used to render his 08:30 shift as 01:30 in the card header
 * while the row beneath it (already pinned to Israel) said 08:30 — the same
 * shift, two hours, on one screen.
 */
describe("rendering from a device outside Israel", () => {
  const ORIGINAL_TZ = process.env.TZ;
  const away = <T,>(timeZone: string, run: () => T): T => {
    process.env.TZ = timeZone;
    try {
      return run();
    } finally {
      process.env.TZ = ORIGINAL_TZ;
    }
  };

  it("a stored instant keeps its Israeli hour on any device", () => {
    for (const timeZone of ["America/New_York", "Asia/Tokyo", "UTC"]) {
      expect(away(timeZone, () => formatShortDateTime("2026-09-22T05:30:00.000Z"))).toBe("22/09/26 08:30");
      expect(away(timeZone, () => formatTimeOnly("2026-09-22T05:30:00.000Z"))).toBe("08:30");
    }
  });

  it("an instant that is already tomorrow in Israel says tomorrow, wherever it is read", () => {
    expect(away("America/Los_Angeles", () => formatShortDateTime("2026-08-31T21:30:00.000Z"))).toBe(
      "01/09/26 00:30"
    );
  });

  it("a date-only value never moves — it has no hour to convert", () => {
    for (const timeZone of ["America/New_York", "Asia/Tokyo", "UTC"]) {
      expect(away(timeZone, () => formatShortDate("2026-01-01"))).toBe("01/01/26");
    }
  });

  it("an offset-less timestamp is read as the Israeli wall clock it was typed as", () => {
    expect(away("America/New_York", () => formatShortDateTime("2026-01-05T14:30:00"))).toBe("05/01/26 14:30");
  });

  it("due-date urgency counts from Israel's today, not the device's", () => {
    expect(away("Asia/Tokyo", () => getDueUrgency("2026-06-15", { refDate: "2026-06-15" }))).toBe("due-soon");
    expect(away("America/Los_Angeles", () => getDueUrgency("2026-06-14", { refDate: "2026-06-15" }))).toBe(
      "overdue"
    );
  });
});
