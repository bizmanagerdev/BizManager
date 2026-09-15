// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  armNativeSurfaceGuard,
  consumeNativeSurfaceGuard,
  resetNativeSurfaceGuard,
} from "@/components/ui/native-surface";
import { DateInput } from "@/components/ui/date-input";
import { FormDialog } from "@/components/ui/form-dialog";

afterEach(() => {
  resetNativeSurfaceGuard();
  vi.useRealTimers();
});

describe("native surface guard", () => {
  it("is not armed by default", () => {
    expect(consumeNativeSurfaceGuard()).toBe(false);
  });

  it("absorbs exactly one outside interaction once armed", () => {
    armNativeSurfaceGuard();
    expect(consumeNativeSurfaceGuard()).toBe(true);
    expect(consumeNativeSurfaceGuard()).toBe(false);
  });

  // The guard exists to survive one replayed tap, not to linger. A pointer
  // event the page actually saw means the user is back — anything after that is
  // a real interaction and must reach the dialog.
  it("expires after the next pointer event, wherever it lands", async () => {
    armNativeSurfaceGuard();
    fireEvent.pointerDown(document.body);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consumeNativeSurfaceGuard()).toBe(false);
  });

  it("arming it again re-opens the window", async () => {
    armNativeSurfaceGuard();
    fireEvent.pointerDown(document.body);
    await new Promise((resolve) => setTimeout(resolve, 0));
    armNativeSurfaceGuard();
    expect(consumeNativeSurfaceGuard()).toBe(true);
  });
});

describe("DateInput calendar button", () => {
  it("arms the guard before opening the OS picker", () => {
    render(<DateInput value="2026-09-15" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "בחר תאריך" }));
    expect(consumeNativeSurfaceGuard()).toBe(true);
  });

  it("arms nothing when the date is typed by hand — the path that always worked", () => {
    render(<DateInput value="" onChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("dd/mm/yy"), { target: { value: "15/09/26" } });
    expect(consumeNativeSurfaceGuard()).toBe(false);
  });
});

// The whole point: a FormDialog holding a date field must survive the OS picker
// handing the page back, and must NOT survive a genuine backdrop press.
function DialogHarness({ onOpenChange }: { onOpenChange: (next: boolean) => void }) {
  const [date, setDate] = useState("2026-09-15");
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title="טופס"
      onSubmit={() => {}}
      submitLabel="שמור"
    >
      <DateInput value={date} onChange={(event) => setDate(event.target.value)} />
    </FormDialog>
  );
}

describe("FormDialog with a date field", () => {
  it("ignores the interaction handed back by the OS picker", async () => {
    const onOpenChange = vi.fn();
    render(<DialogHarness onOpenChange={onOpenChange} />);

    // Radix arms its own outside-pointerdown listener on a timeout — without
    // this wait the press below would be ignored for the wrong reason.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "בחר תאריך" }));
    // The tap that dismissed the picker, replayed onto the page underneath.
    fireEvent.pointerDown(document.body);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText("יש שינויים שלא נשמרו")).not.toBeInTheDocument();
  });

  it("still closes on a real press outside it", async () => {
    const onOpenChange = vi.fn();
    render(<DialogHarness onOpenChange={onOpenChange} />);

    // Radix arms its own outside-pointerdown listener on a timeout.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
