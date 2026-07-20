import { describe, it, expect } from "vitest";
import {
  toDateOnly,
  startOfWeek,
  addDays,
  isSameDay,
  addWorkingDays,
  subtractWorkingDays,
  buildWeekView,
} from "@/lib/dashboard/week";
import type { CalendarEntry } from "@/lib/projectSchedule";

// Characterization tests for the shared week-bucketing logic (used by the inline
// WeekOverview and the dashboard "מה קורה השבוע" quick action). Previously untested.

function entry(over: Partial<CalendarEntry> & { id: string; kind: "project" | "task" }): CalendarEntry {
  return { startDate: null, endDate: null, ...over } as unknown as CalendarEntry;
}

describe("subtractWorkingDays — N work-days before (Fri+Sat don't count)", () => {
  it("a Saturday minus 3 work-days lands on the Tuesday (Fri is skipped)", () => {
    // 2026-07-25 is a Saturday. Thu(23), Wed(22), Tue(21) → Tuesday.
    const sat = new Date(2026, 6, 25);
    expect(sat.getDay()).toBe(6);
    const result = subtractWorkingDays(sat, 3);
    expect(result.getDay()).toBe(2); // Tuesday
    expect(result.getDate()).toBe(21);
  });

  it("skips the weekend when counting back across it", () => {
    // Monday 2026-07-20 minus 1 work-day → Thursday 2026-07-16 (skips Sun? no —
    // back from Mon: Sun(19)? Sun IS a work day in Israel). Mon→Sun = 1 work day.
    const mon = new Date(2026, 6, 20);
    expect(mon.getDay()).toBe(1);
    const result = subtractWorkingDays(mon, 1);
    expect(result.getDay()).toBe(0); // Sunday (a work day in Israel)
  });

  it("0 work-days returns the same day", () => {
    const d = new Date(2026, 6, 20);
    expect(subtractWorkingDays(d, 0).getTime()).toBe(new Date(2026, 6, 20).getTime());
  });
});

describe("date helpers", () => {
  it("toDateOnly parses a YYYY-MM-DD prefix and rejects junk", () => {
    expect(toDateOnly("2024-05-15T09:00")).toEqual(new Date(2024, 4, 15));
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly("nope")).toBeNull();
  });
  it("startOfWeek snaps to the Sunday of that week", () => {
    expect(startOfWeek(new Date(2024, 4, 15))).toEqual(new Date(2024, 4, 12)); // Wed → Sun
  });
  it("addDays / isSameDay", () => {
    expect(addDays(new Date(2024, 4, 12), 6)).toEqual(new Date(2024, 4, 18));
    expect(isSameDay(new Date(2024, 4, 15, 9), new Date(2024, 4, 15, 23))).toBe(true);
    expect(isSameDay(new Date(2024, 4, 15), new Date(2024, 4, 16))).toBe(false);
  });
  it("addWorkingDays skips Friday and Saturday", () => {
    // Thu 2024-05-16 + 1 working day → Sun 2024-05-19 (skips Fri 17, Sat 18).
    expect(addWorkingDays(new Date(2024, 4, 16), 1)).toEqual(new Date(2024, 4, 19));
  });
});

describe("buildWeekView", () => {
  const today = new Date(2024, 4, 15); // Wed 2024-05-15 → week Sun 12 … Sat 18

  it("sets the Sun–Sat span and marks today", () => {
    const view = buildWeekView([], today);
    expect(view.weekStart).toEqual(new Date(2024, 4, 12));
    expect(view.weekEnd).toEqual(new Date(2024, 4, 18));
    expect(view.days).toHaveLength(7);
    expect(view.days.find((d) => d.isToday)?.day).toEqual(new Date(2024, 4, 15));
  });

  it("places a task only on its due day", () => {
    const view = buildWeekView([entry({ id: "t1", kind: "task", startDate: "2024-05-14" })], today);
    const onDay = view.days.filter((d) => d.entries.some((e) => e.id === "t1"));
    expect(onDay).toHaveLength(1);
    expect(onDay[0].day).toEqual(new Date(2024, 4, 14));
  });

  it("spreads a short project across each active day within the week", () => {
    const view = buildWeekView(
      [entry({ id: "p1", kind: "project", startDate: "2024-05-13", endDate: "2024-05-15" })],
      today
    );
    const days = view.days.filter((d) => d.entries.some((e) => e.id === "p1")).map((d) => d.day.getDate());
    expect(days).toEqual([13, 14, 15]);
  });

  it("treats a long (15+ day) project that started earlier as a general legend, not per-day", () => {
    const view = buildWeekView(
      [entry({ id: "big", kind: "project", startDate: "2024-04-01", endDate: "2024-06-01" })],
      today
    );
    expect(view.generalEntries.map((e) => e.id)).toEqual(["big"]);
    expect(view.days.every((d) => d.entries.length === 0)).toBe(true);
  });

  it("totalCount sums the legend and per-day entries", () => {
    const view = buildWeekView(
      [
        entry({ id: "big", kind: "project", startDate: "2024-04-01", endDate: "2024-06-01" }),
        entry({ id: "t1", kind: "task", startDate: "2024-05-14" }),
      ],
      today
    );
    expect(view.totalCount).toBe(2); // 1 general + 1 task day
  });
});
