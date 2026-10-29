// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// The menu count badges ask the server only while someone can see them
// (owner, 2026-10-29): every open copy used to ask every minute, hidden
// windows and phones that never showed the numbers included — 19,367 times a
// week, about 5x the busiest page.

let visibility: DocumentVisibilityState = "visible";
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ counts: { "/tasks": { count: 3, severity: "warning" } } })));

async function loadStore() {
  // A fresh module each test: the store keeps its timer and last ask in module state.
  vi.resetModules();
  return import("@/lib/ui/nav-counts-store");
}

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("menu count badges — when they ask", () => {
  it("the menu on screen asks at once, then once a minute while the window is visible", async () => {
    const { useNavCounts, NAV_COUNTS_POLL_MS } = await loadStore();
    const { result } = renderHook(() => useNavCounts({ poll: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current["/tasks"]).toEqual({ count: 3, severity: "warning" });
    await act(async () => {
      vi.advanceTimersByTime(NAV_COUNTS_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("asks nothing while the window is hidden, and asks at once when it comes back", async () => {
    const { useNavCounts, NAV_COUNTS_POLL_MS } = await loadStore();
    renderHook(() => useNavCounts({ poll: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => setVisibility("hidden"));
    await act(async () => {
      vi.advanceTimersByTime(NAV_COUNTS_POLL_MS * 30);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Coming back also fires focus: one ask for both.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(NAV_COUNTS_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a menu that isn't the one on this screen (the side menu on a phone) asks for nothing", async () => {
    const { useNavCounts, NAV_COUNTS_POLL_MS } = await loadStore();
    renderHook(() => useNavCounts({ poll: false }));
    await act(async () => {
      vi.advanceTimersByTime(NAV_COUNTS_POLL_MS * 5);
    });
    window.dispatchEvent(new Event("focus"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a window opened in the background waits until it's looked at", async () => {
    visibility = "hidden";
    const { useNavCounts, NAV_COUNTS_POLL_MS } = await loadStore();
    renderHook(() => useNavCounts({ poll: true }));
    await act(async () => {
      vi.advanceTimersByTime(NAV_COUNTS_POLL_MS * 5);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => setVisibility("visible"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops when the menu goes (unmounted)", async () => {
    const { useNavCounts, NAV_COUNTS_POLL_MS } = await loadStore();
    const { unmount } = renderHook(() => useNavCounts({ poll: true }));
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(NAV_COUNTS_POLL_MS * 5);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a menu drawn on the server, or hydrating after the other menu already asked, starts with no counts", async () => {
    const { refreshNavCounts, useNavCounts } = await loadStore();
    const { renderToString } = await import("react-dom/server");
    refreshNavCounts();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    function Probe() {
      return <span>{JSON.stringify(useNavCounts({ poll: false }))}</span>;
    }
    // The side menu hydrates late (a Suspense); the phone menu had already
    // asked. Its first draw must match the server's: no badges.
    expect(renderToString(<Probe />)).toContain("{}");
    const { result } = renderHook(() => useNavCounts({ poll: false }));
    expect(result.current["/tasks"]).toEqual({ count: 3, severity: "warning" });
  });

  it("refreshNavCounts asks now (the phone's עוד sheet opening, an alert dealt with)", async () => {
    const { refreshNavCounts } = await loadStore();
    refreshNavCounts();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
