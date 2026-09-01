// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MonthNav, fmtMonthYear, isSameDay, isoLocal, toDateOnly } from "@/components/ui/month-calendar";

// Scoped to the pure date helpers and MonthNav (the self-contained
// month-navigation group). The full MonthCalendar grid — render props, real
// "today", the Hebrew-holiday data feed, wheel/touch swipe-to-navigate — is
// left untested for now; it's a much bigger surface (and its two current
// callers, ProjectsCalendar/PaymentsCalendar, would be a more direct way to
// exercise it end-to-end than reconstructing the render props here).
describe("isoLocal", () => {
  it("formats a local date as YYYY-MM-DD, zero-padded", () => {
    expect(isoLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(isoLocal(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("toDateOnly", () => {
  it("parses an ISO-prefixed string as a local date, ignoring any time/zone suffix", () => {
    const d = toDateOnly("2026-09-17T14:30:00Z")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(17);
  });

  it("returns null for empty or unparseable input", () => {
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly("")).toBeNull();
    expect(toDateOnly("not a date")).toBeNull();
  });
});

describe("isSameDay", () => {
  it("compares by calendar day, not by time", () => {
    expect(isSameDay(new Date(2026, 8, 17, 1, 0), new Date(2026, 8, 17, 23, 59))).toBe(true);
    expect(isSameDay(new Date(2026, 8, 17), new Date(2026, 8, 18))).toBe(false);
  });
});

describe("fmtMonthYear", () => {
  it("formats a date as a Hebrew-locale 'month year'", () => {
    // he-IL's month name is locale data, not something to hardcode across
    // ICU versions — just assert the year appears and it's non-empty.
    const label = fmtMonthYear(new Date(2026, 8, 1));
    expect(label).toContain("2026");
    expect(label.length).toBeGreaterThan(4);
  });
});

describe("MonthNav", () => {
  const today = new Date(2026, 8, 17);

  it("steps back and forward a month at a time", () => {
    const onChange = vi.fn();
    render(<MonthNav month={new Date(2026, 8, 1)} todayDate={today} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 7, 1));

    fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 9, 1));
  });

  it("wraps the year boundary correctly", () => {
    const onChange = vi.fn();
    render(<MonthNav month={new Date(2026, 0, 1)} todayDate={today} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));
    expect(onChange).toHaveBeenCalledWith(new Date(2025, 11, 1));
  });

  it("the 'today' button jumps to the current month and is disabled once already there", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MonthNav month={new Date(2026, 5, 1)} todayDate={today} onChange={onChange} />
    );
    const todayButton = screen.getByRole("button", { name: "היום" });
    expect(todayButton).not.toBeDisabled();
    fireEvent.click(todayButton);
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 1));

    rerender(<MonthNav month={new Date(2026, 8, 1)} todayDate={today} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "היום" })).toBeDisabled();
  });
});
