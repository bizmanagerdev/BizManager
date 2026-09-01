// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SwipeActions, type SwipeAction } from "@/components/ui/swipe-actions";

// SwipeActions replaces a stack of buttons under every mobile card with a
// swipe-to-reveal strip — see the component's own comments on why: the
// direction lock (undecided until ~10px of movement) stops a diagonal
// thumb-flick while scrolling from peeling a card open, and an open row
// swallows its next tap so a stray tap can't fire the action underneath.
// actionWidth=100 here so the numbers below are round: stripWidth=100 for one
// action, OPEN_THRESHOLD (0.4) = 40px.
const ACTIONS: SwipeAction[] = [{ key: "delete", label: "מחיקה", onSelect: vi.fn() }];

function drag(card: HTMLElement, path: Array<{ x: number; y: number }>) {
  const [first, ...rest] = path;
  fireEvent.pointerDown(card, { clientX: first.x, clientY: first.y, button: 0, pointerType: "mouse" });
  for (const point of rest) {
    fireEvent.pointerMove(card, { clientX: point.x, clientY: point.y, button: 0, pointerType: "mouse" });
  }
}

describe("SwipeActions", () => {
  it("renders the card content", () => {
    render(
      <SwipeActions actions={ACTIONS} open={false} onOpenChange={() => {}} actionWidth={100}>
        <div>שורה</div>
      </SwipeActions>
    );
    expect(screen.getByText("שורה")).toBeInTheDocument();
  });

  it("a drag under the direction-lock threshold never resolves to a swipe", () => {
    const onOpenChange = vi.fn();
    render(
      <SwipeActions actions={ACTIONS} open={false} onOpenChange={onOpenChange} actionWidth={100}>
        <div>שורה</div>
      </SwipeActions>
    );
    const card = screen.getByText("שורה").closest("[class*='touch-pan-y']") as HTMLElement;
    drag(card, [
      { x: 0, y: 0 },
      { x: 5, y: 0 }, // under DIRECTION_LOCK (10px) — axis stays undecided
    ]);
    fireEvent.pointerUp(card, { clientX: 5, clientY: 0, pointerType: "mouse" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("a vertical drag locks to the list's scroll, not the swipe", () => {
    const onOpenChange = vi.fn();
    render(
      <SwipeActions actions={ACTIONS} open={false} onOpenChange={onOpenChange} actionWidth={100}>
        <div>שורה</div>
      </SwipeActions>
    );
    const card = screen.getByText("שורה").closest("[class*='touch-pan-y']") as HTMLElement;
    drag(card, [
      { x: 0, y: 0 },
      { x: 5, y: 30 }, // mostly vertical -> locks to vertical (axis=false)
      { x: 60, y: 30 }, // even a big horizontal move afterward is ignored
    ]);
    fireEvent.pointerUp(card, { clientX: 60, clientY: 30, pointerType: "mouse" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("releasing past the open threshold snaps open; short of it snaps closed", () => {
    const onOpenChangeOpen = vi.fn();
    const { unmount } = render(
      <SwipeActions actions={ACTIONS} open={false} onOpenChange={onOpenChangeOpen} actionWidth={100}>
        <div>שורה</div>
      </SwipeActions>
    );
    let card = screen.getByText("שורה").closest("[class*='touch-pan-y']") as HTMLElement;
    drag(card, [
      { x: 0, y: 0 },
      { x: 50, y: 0 }, // past OPEN_THRESHOLD (40px of a 100px strip)
    ]);
    fireEvent.pointerUp(card, { clientX: 50, clientY: 0, pointerType: "mouse" });
    expect(onOpenChangeOpen).toHaveBeenCalledWith(true);
    unmount();

    const onOpenChangeClosed = vi.fn();
    render(
      <SwipeActions actions={ACTIONS} open={false} onOpenChange={onOpenChangeClosed} actionWidth={100}>
        <div>שורה</div>
      </SwipeActions>
    );
    card = screen.getByText("שורה").closest("[class*='touch-pan-y']") as HTMLElement;
    drag(card, [
      { x: 0, y: 0 },
      { x: 20, y: 0 }, // short of OPEN_THRESHOLD
    ]);
    fireEvent.pointerUp(card, { clientX: 20, clientY: 0, pointerType: "mouse" });
    expect(onOpenChangeClosed).toHaveBeenCalledWith(false);
  });

  it("clamps the drag so it can never pass the strip's own width", () => {
    const onOpenChange = vi.fn();
    render(
      <SwipeActions actions={ACTIONS} open={false} onOpenChange={onOpenChange} actionWidth={100}>
        <div>שורה</div>
      </SwipeActions>
    );
    const card = screen.getByText("שורה").closest("[class*='touch-pan-y']") as HTMLElement;
    drag(card, [
      { x: 0, y: 0 },
      { x: 500, y: 0 }, // way past the 100px strip
    ]);
    expect(card.style.transform).toBe("translateX(100px)");
  });

  it("while open, tapping the card closes it and swallows the tap (the card's own onClick never fires)", () => {
    const onOpenChange = vi.fn();
    const cardClick = vi.fn();
    render(
      <SwipeActions actions={ACTIONS} open onOpenChange={onOpenChange} actionWidth={100}>
        <button type="button" onClick={cardClick}>
          שורה
        </button>
      </SwipeActions>
    );
    fireEvent.click(screen.getByText("שורה"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(cardClick).not.toHaveBeenCalled();
  });

  it("while closed, tapping the card behaves normally (no swallow)", () => {
    const onOpenChange = vi.fn();
    const cardClick = vi.fn();
    render(
      <SwipeActions actions={ACTIONS} open={false} onOpenChange={onOpenChange} actionWidth={100}>
        <button type="button" onClick={cardClick}>
          שורה
        </button>
      </SwipeActions>
    );
    fireEvent.click(screen.getByText("שורה"));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(cardClick).toHaveBeenCalledTimes(1);
  });

  it("clicking a revealed action closes the row and fires its onSelect", () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <SwipeActions
        actions={[{ key: "delete", label: "מחיקה", onSelect }]}
        open
        onOpenChange={onOpenChange}
        actionWidth={100}
      >
        <div>שורה</div>
      </SwipeActions>
    );
    fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("action buttons are only keyboard-reachable while the row is open", () => {
    const { rerender } = render(
      <SwipeActions actions={ACTIONS} open={false} onOpenChange={() => {}} actionWidth={100}>
        <div>שורה</div>
      </SwipeActions>
    );
    // The whole strip is aria-hidden while closed (correctly, since it's
    // untabbable) — getByRole needs `hidden: true` to still find it here.
    expect(screen.getByRole("button", { name: "מחיקה", hidden: true })).toHaveAttribute("tabindex", "-1");

    rerender(
      <SwipeActions actions={ACTIONS} open onOpenChange={() => {}} actionWidth={100}>
        <div>שורה</div>
      </SwipeActions>
    );
    expect(screen.getByRole("button", { name: "מחיקה" })).toHaveAttribute("tabindex", "0");
  });
});
