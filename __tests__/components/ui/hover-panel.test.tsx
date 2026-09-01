// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHoverPanel } from "@/components/ui/hover-panel";

// useHoverPanel is the open/close timing logic behind every hover-to-peek
// panel in the app — the actual Popover wiring (HoverPanel/HoverPanelContent)
// is Radix Popover (floating-ui), so it's left untested here per the
// documented SearchableSelect cold-start tradeoff; this hook is where the
// real behavior (the close-delay grace period) lives, and it's plain
// state+timers, no DOM needed.
describe("useHoverPanel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts closed", () => {
    const { result } = renderHook(() => useHoverPanel());
    expect(result.current.open).toBe(false);
  });

  it("show() opens immediately", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.show());
    expect(result.current.open).toBe(true);
  });

  // hideSoon isn't exposed directly — it's wired up as the onMouseLeave of
  // both triggerProps and panelProps, which is the real public surface
  // (spread onto the trigger and the portaled panel respectively).
  it("leaving the trigger/panel (onMouseLeave) closes it only after the delay elapses", () => {
    const { result } = renderHook(() => useHoverPanel(180));
    act(() => result.current.show());
    act(() => result.current.triggerProps.onMouseLeave());
    expect(result.current.open).toBe(true); // not yet — grace period still running

    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(result.current.open).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.open).toBe(false);
  });

  it("re-entering (onMouseEnter) before the delay elapses cancels the pending close", () => {
    const { result } = renderHook(() => useHoverPanel(180));
    act(() => result.current.show());
    act(() => result.current.triggerProps.onMouseLeave());
    // The pointer crossed the gap into the panel in time.
    act(() => result.current.panelProps.onMouseEnter());

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.open).toBe(true);
  });

  it("hide() closes immediately, bypassing the grace period", () => {
    const { result } = renderHook(() => useHoverPanel(180));
    act(() => result.current.show());
    act(() => result.current.hide());
    expect(result.current.open).toBe(false);
  });

  it("setOpen sets the state directly", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
  });

  it("triggerProps.onFocus also opens it (keyboard focus, not just hover)", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.triggerProps.onFocus());
    expect(result.current.open).toBe(true);
  });
});
