// @vitest-environment jsdom
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DialogChromeHeader, useSwipeToDismiss } from "@/components/ui/dialog-chrome";

describe("DialogChromeHeader", () => {
  it("renders children and calls onClose when the X is clicked", () => {
    const onClose = vi.fn();
    render(
      <DialogChromeHeader onClose={onClose}>
        <span>כותרת</span>
      </DialogChromeHeader>
    );
    expect(screen.getByText("כותרת")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the close button when closeDisabled is set", () => {
    const onClose = vi.fn();
    render(
      <DialogChromeHeader onClose={onClose} closeDisabled>
        <span>כותרת</span>
      </DialogChromeHeader>
    );
    const button = screen.getByRole("button", { name: "סגירה" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders no close button at all when onClose is omitted", () => {
    render(
      <DialogChromeHeader>
        <span>כותרת</span>
      </DialogChromeHeader>
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// useSwipeToDismiss drives a full-page mobile dialog's swipe-down-to-close —
// see its own comment on why the drag distance is NOT React state (a re-render
// per touchmove couldn't keep up with 60fps). Exercised here through a small
// harness component wired the same way FormDialog/StepWizardDialog use it.
function SwipeHarness({ enabled, onDismiss }: { enabled: boolean; onDismiss: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const swipeProps = useSwipeToDismiss({ enabled, bodyRef, onDismiss });
  return (
    <div data-testid="panel" data-state="open" {...swipeProps}>
      <div ref={bodyRef} data-testid="body">
        <button type="button" data-testid="calendar-icon">
          בחר תאריך
        </button>
      </div>
    </div>
  );
}

describe("useSwipeToDismiss", () => {
  it("attaches no touch handlers at all when disabled", () => {
    const onDismiss = vi.fn();
    render(<SwipeHarness enabled={false} onDismiss={onDismiss} />);
    const panel = screen.getByTestId("panel");
    fireEvent.touchStart(panel, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(panel);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses once the drag passes the threshold, but not before", () => {
    const onDismiss = vi.fn();
    render(<SwipeHarness enabled onDismiss={onDismiss} />);
    const panel = screen.getByTestId("panel");

    fireEvent.touchStart(panel, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 50 }] }); // under FULL_SCREEN_DISMISS_THRESHOLD (120)
    fireEvent.touchEnd(panel);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.touchStart(panel, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 200 }] }); // past the threshold
    fireEvent.touchEnd(panel);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores an upward drag (never counts negative distance toward the threshold)", () => {
    const onDismiss = vi.fn();
    render(<SwipeHarness enabled onDismiss={onDismiss} />);
    const panel = screen.getByTestId("panel");

    fireEvent.touchStart(panel, { touches: [{ clientY: 300 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 0 }] }); // dragging UP
    fireEvent.touchEnd(panel);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("a touchcancel resets the drag without dismissing", () => {
    const onDismiss = vi.fn();
    render(<SwipeHarness enabled onDismiss={onDismiss} />);
    const panel = screen.getByTestId("panel");

    fireEvent.touchStart(panel, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 300 }] });
    fireEvent.touchCancel(panel);
    fireEvent.touchEnd(panel);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  // The calendar icon opens an OS date picker, which swallows the touchend —
  // so the drag must never be armed from a control in the first place, and a
  // sequence that never ended must not anchor the NEXT one.
  it("never starts a drag from a control (the OS picker would swallow the touchend)", () => {
    const onDismiss = vi.fn();
    render(<SwipeHarness enabled onDismiss={onDismiss} />);
    const panel = screen.getByTestId("panel");

    fireEvent.touchStart(screen.getByTestId("calendar-icon"), { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 400 }] });
    fireEvent.touchEnd(panel);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not measure a drag against an abandoned sequence's anchor", () => {
    const onDismiss = vi.fn();
    render(<SwipeHarness enabled onDismiss={onDismiss} />);
    const panel = screen.getByTestId("panel");
    const body = screen.getByTestId("body");

    // A touch that starts at the top and never ends — the picker took over.
    fireEvent.touchStart(panel, { touches: [{ clientY: 0 }] });

    // The field scrolled into view, so the next touchstart is a no-drag one.
    Object.defineProperty(body, "scrollTop", { value: 120, configurable: true });
    fireEvent.touchStart(panel, { touches: [{ clientY: 250 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 400 }] });
    fireEvent.touchEnd(panel);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("puts the panel back when onDismiss refuses to close (unsaved-changes prompt)", async () => {
    // onDismiss that doesn't close: data-state stays "open", the way FormDialog
    // leaves it while the discard prompt is up.
    const onDismiss = vi.fn();
    render(<SwipeHarness enabled onDismiss={onDismiss} />);
    const panel = screen.getByTestId("panel");

    fireEvent.touchStart(panel, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(panel);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(panel.style.transform).not.toBe("");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.style.transform).toBe("");
  });

  it("leaves the panel off-screen when the close actually took", async () => {
    const onDismiss = vi.fn();
    render(<SwipeHarness enabled onDismiss={onDismiss} />);
    const panel = screen.getByTestId("panel");
    onDismiss.mockImplementation(() => panel.setAttribute("data-state", "closed"));

    fireEvent.touchStart(panel, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(panel);

    await new Promise((resolve) => setTimeout(resolve, 0));
    // Snapping back here is the "jump" the off-screen transform exists to avoid.
    expect(panel.style.transform).not.toBe("");
  });
});
