// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// The top loading bar ends when the page is on screen — not most of a second
// later (owner, 2026-10-07: "the page loads and then the bar"). A page drawn
// at once from the phone's copy says so and the bar finishes then; a page
// that arrives without a loading screen isn't given 700 ms to grow one.

const route = vi.hoisted(() => ({ path: "/projects" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.path,
  useSearchParams: () => new URLSearchParams(),
}));

import {
  TopNavigationProgress,
  emitNavigationContentShown,
  emitNavigationStart,
} from "@/components/layout/TopNavigationProgress";

const bar = () => document.querySelector('[class*="z-[120]"]');

describe("the top loading bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    route.path = "/projects";
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ends as soon as the page being opened is on screen — even before the address catches up", async () => {
    const { rerender } = render(<TopNavigationProgress />);
    act(() => emitNavigationStart());
    expect(bar()).not.toBeNull();

    act(() => emitNavigationContentShown()); // drawn from the phone's copy over the list
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(bar()).toBeNull();

    // The address changes behind it: no second bar.
    route.path = "/projects/p1";
    rerender(<TopNavigationProgress />);
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(bar()).toBeNull();
  });

  it("a page that arrives without a loading screen: ends right after, not most of a second later", async () => {
    const { rerender } = render(<TopNavigationProgress />);
    act(() => emitNavigationStart());
    route.path = "/sales";
    rerender(<TopNavigationProgress />);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(bar()).toBeNull();
  });

  it("a page with a loading screen: runs until the screen goes", async () => {
    const { rerender } = render(<TopNavigationProgress />);
    act(() => emitNavigationStart());
    const skeleton = document.createElement("div");
    skeleton.setAttribute("data-route-loading", "true");
    document.body.appendChild(skeleton);
    route.path = "/reports";
    rerender(<TopNavigationProgress />);
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(bar()).not.toBeNull();
    await act(async () => {
      skeleton.remove();
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(bar()).toBeNull();
  });
});
