// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";

// Exposes the emitted ISO value alongside the input, so tests can check BOTH
// what's displayed (dd/mm/yy) and what the form actually receives (ISO) —
// they can diverge (e.g. mid-typing, or on an invalid blur that reverts).
function ControlledDate({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateInput data-testid="date" value={value} onChange={(e) => setValue(e.target.value)} />
      <span data-testid="iso">{value}</span>
    </>
  );
}

function ControlledDateTime({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateTimeInput data-testid="datetime" value={value} onChange={(e) => setValue(e.target.value)} />
      <span data-testid="iso">{value}</span>
    </>
  );
}

// DateInput/DateTimeInput carry real parsing/masking logic (dd/mm/yy display
// over an ISO value, auto-inserted slashes, a 2-digit year pivot, revert on a
// bad blur) — see date-input.tsx's own comments on the masked-input backspace
// bug this guards against. One shared component fixes every date field in the
// app, so a regression here is app-wide.
//
// Interactions go through fireEvent.change with the RAW digit-only string the
// user is assumed to type (this component re-derives slashes from position,
// not from what the user typed — typing your own "/" mid-stream gets
// re-grouped, which is real, deliberate behavior, not something to route
// around here). userEvent.type()'s per-keystroke caret simulation doesn't
// reliably match this un-caret-managed input in jsdom; fireEvent.change with
// the resulting raw value is what the component's onChange actually receives.
describe("DateInput", () => {
  it("displays an ISO value as dd/mm/yy", () => {
    render(<ControlledDate initial="2026-09-17" />);
    expect(screen.getByTestId("date")).toHaveValue("17/09/26");
  });

  it("auto-inserts slashes as digits are typed, and emits the full ISO value", () => {
    render(<ControlledDate />);
    const el = screen.getByTestId("date");

    fireEvent.change(el, { target: { value: "17092026" } });

    // Settles back to a 2-digit-year display: once 8 digits parse to a valid
    // date, the ISO value round-trips through the parent, and the component's
    // own effect re-derives `displayValue` from it via `formatIsoForDisplay`
    // — which is always dd/mm/YY, never a 4-digit year on screen.
    expect(el).toHaveValue("17/09/26");
    expect(screen.getByTestId("iso")).toHaveTextContent("2026-09-17");
  });

  it("reverts to the last valid value when blurred with an incomplete/invalid date", () => {
    render(<ControlledDate initial="2026-09-17" />);
    const el = screen.getByTestId("date");

    fireEvent.change(el, { target: { value: "31/02" } }); // Feb 31 doesn't exist, and it's incomplete
    fireEvent.blur(el);

    expect(el).toHaveValue("17/09/26");
    expect(screen.getByTestId("iso")).toHaveTextContent("2026-09-17");
  });

  it("commits a fully-typed valid date on blur, normalizing the display", () => {
    render(<ControlledDate />);
    const el = screen.getByTestId("date");

    fireEvent.change(el, { target: { value: "010126" } }); // 01/01/26
    fireEvent.blur(el);

    expect(el).toHaveValue("01/01/26");
    expect(screen.getByTestId("iso")).toHaveTextContent("2026-01-01");
  });

  it("pivots a 2-digit year: >=70 means 19xx, <70 means 20xx", () => {
    const { unmount } = render(<ControlledDate />);
    let el = screen.getByTestId("date");
    fireEvent.change(el, { target: { value: "010175" } }); // day 01, month 01, year 75
    fireEvent.blur(el);
    expect(screen.getByTestId("iso")).toHaveTextContent("1975-01-01");
    unmount();

    render(<ControlledDate />);
    el = screen.getByTestId("date");
    fireEvent.change(el, { target: { value: "010126" } }); // year 26
    fireEvent.blur(el);
    expect(screen.getByTestId("iso")).toHaveTextContent("2026-01-01");
  });

  it("fixes the classic masked-input bug: backspacing a separator removes a digit too", () => {
    render(<ControlledDate />);
    const el = screen.getByTestId("date");

    fireEvent.change(el, { target: { value: "1709" } }); // -> "17/09"
    expect(el).toHaveValue("17/09");

    // Backspacing the last character removes only the "/" (raw shrinks by
    // one, digit count is unchanged) — without the fix this would instantly
    // re-insert the same "/" and backspace would look stuck.
    fireEvent.change(el, { target: { value: "17/0" } });
    expect(el).toHaveValue("17/0");
  });
});

describe("DateTimeInput", () => {
  it("displays an ISO datetime as dd/mm/yy hh:mm", () => {
    render(<ControlledDateTime initial="2026-09-17T14:30" />);
    expect(screen.getByTestId("datetime")).toHaveValue("17/09/26 14:30");
  });

  it("auto-inserts separators (slashes, space, colon) and emits the full ISO value", () => {
    render(<ControlledDateTime />);
    const el = screen.getByTestId("datetime");

    fireEvent.change(el, { target: { value: "170920261430" } });

    // Same settle-to-2-digit-year behavior as DateInput, once it round-trips.
    expect(el).toHaveValue("17/09/26 14:30");
    expect(screen.getByTestId("iso")).toHaveTextContent("2026-09-17T14:30");
  });

  it("rejects an out-of-range time on blur and reverts", () => {
    render(<ControlledDateTime initial="2026-09-17T14:30" />);
    const el = screen.getByTestId("datetime");

    fireEvent.change(el, { target: { value: "1709262599" } }); // hour 25, minute 99 — no such time
    fireEvent.blur(el);

    expect(el).toHaveValue("17/09/26 14:30");
    expect(screen.getByTestId("iso")).toHaveTextContent("2026-09-17T14:30");
  });
});
