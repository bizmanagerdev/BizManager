// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// The top loading bar shows only for a page that takes a moment to open, and
// ends when the page is on screen — not after it (owner, 2026-10-07: "the page
// loads and then the bar"; "when open is instant no bar").

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

/** Advance `ms` in small steps; true if the bar was on screen at any of them. */
async function barSeenWithin(ms: number) {
  let seen = false;
  for (let t = 0; t < ms; t += 10) {
    await act(async () => vi.advanceTimersByTimeAsync(10));
    if (bar()) seen = true;
  }
  return seen;
}

describe("the top loading bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    route.path = "/projects";
  });
  afterEach(() => {
    cleanup();
    document.querySelectorAll("[data-route-loading]").forEach((el) => el.remove());
    vi.useRealTimers();
  });

  it("an instant opening (drawn from the phone's copy): no bar at all — not even when the address catches up", async () => {
    const { rerender } = render(<TopNavigationProgress />);
    act(() => emitNavigationStart());
    expect(await barSeenWithin(40)).toBe(false);

    act(() => emitNavigationContentShown()); // drawn over the list
    expect(await barSeenWithin(300)).toBe(false);

    route.path = "/projects/p1"; // the server's page arrives behind it
    rerender(<TopNavigationProgress />);
    expect(await barSeenWithin(300)).toBe(false);
  });

  it("a page opened before (no loading screen, there at once): no bar", async () => {
    const { rerender } = render(<TopNavigationProgress />);
    act(() => emitNavigationStart());
    await act(async () => vi.advanceTimersByTimeAsync(30));
    route.path = "/sales";
    rerender(<TopNavigationProgress />);
    expect(await barSeenWithin(500)).toBe(false);
  });

  it("a page that takes a while (loading screen up): the bar shows, runs until the screen goes, then goes", async () => {
    const { rerender } = render(<TopNavigationProgress />);
    act(() => emitNavigationStart());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(bar()).toBeNull();

    const skeleton = document.createElement("div");
    skeleton.setAttribute("data-route-loading", "true");
    document.body.appendChild(skeleton);
    route.path = "/reports";
    rerender(<TopNavigationProgress />);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(bar()).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(bar()).not.toBeNull();

    await act(async () => {
      skeleton.remove();
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(bar()).toBeNull();
  });

  it("a slow opening that's then drawn: the bar finishes right away, no minimum time on screen", async () => {
    render(<TopNavigationProgress />);
    act(() => emitNavigationStart());
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(bar()).not.toBeNull();

    act(() => emitNavigationContentShown());
    await act(async () => vi.advanceTimersByTimeAsync(150)); // fills to the end and fades
    expect(bar()).toBeNull();
  });
});
