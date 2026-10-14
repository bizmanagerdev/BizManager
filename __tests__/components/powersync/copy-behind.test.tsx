// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

// A copy whose sync can't connect keeps what it had and misses everything since:
// a new order showed on the phone but not in the office computer's orders list
// (2026-10-12). Online, with the sync down for 30 s, the copy counts as behind
// and its pages show the server version — once the server answers.

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, refresh: () => {} }) }));
const toasts = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: toasts.info } }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));
vi.mock("@/lib/powersync/local-results", () => ({
  peekResult: () => ({ data: { rows: [] } }),
  resultKey: () => "k",
  watchResult: () => () => {},
}));

import { COPY_BEHIND_AFTER_MS, setLocalSyncStatus, useLocalCopyBehind, useSyncBlocked } from "@/lib/powersync/store";
import { useLocalCard } from "@/components/powersync/useLocalCard";

const synced = (connected: boolean) => ({
  connected,
  connecting: !connected,
  hasSynced: true,
  lastSyncedAt: null,
  downloading: false,
  uploading: false,
  error: null,
});

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

function setVisible(visible: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (visible ? "visible" : "hidden") });
}

/** The app back on screen (a phone opened again, a tab switched back to). */
function comeBack() {
  setVisible(true);
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  setVisible(true);
  nav.replace.mockReset();
  toasts.info.mockReset();
  setLocalSyncStatus(synced(true));
});
afterEach(() => {
  // Connected: clears a note left by a test (the store keeps it in memory too).
  setLocalSyncStatus(synced(true));
  setLocalSyncStatus(null);
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useLocalCopyBehind", () => {
  it("is false while connected, and true only after 30 s without a connection", () => {
    const { result } = renderHook(() => useLocalCopyBehind());
    expect(result.current).toBe(false);
    act(() => setLocalSyncStatus(synced(false)));
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS - 1000));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
    act(() => setLocalSyncStatus(synced(true)));
    expect(result.current).toBe(false);
  });

  it("offline, the copy is never behind — then it's the whole point", () => {
    setOnline(false);
    const { result } = renderHook(() => useLocalCopyBehind());
    act(() => setLocalSyncStatus(synced(false)));
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS * 3));
    expect(result.current).toBe(false);
  });

  // A phone's sync closes while the app is in the background; counting that
  // time sent the board to the server version the moment it was opened again
  // (Sentry, 2026-10-12). Coming back gets the same 30 s as opening.
  it("time in the background doesn't count — coming back starts the count again", () => {
    const { result, rerender } = renderHook(() => useLocalCopyBehind());
    act(() => setLocalSyncStatus(synced(false)));
    setVisible(false);
    act(() => vi.advanceTimersByTime(40 * 60_000));
    expect(result.current).toBe(false);
    act(() => comeBack());
    rerender();
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS - 1000));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
  });

  it("a check that runs far later than set (the device asleep) starts the count again", () => {
    const { result } = renderHook(() => useLocalCopyBehind());
    act(() => setLocalSyncStatus(synced(false)));
    // Asleep: the clock moves on, the timers don't.
    vi.setSystemTime(Date.now() + 40 * 60_000);
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS));
    expect(result.current).toBe(true);
  });

  // An office computer behind a filter that blocks the sync drew every page
  // from its old copy, then swapped to the server version (Sentry,
  // 2026-10-14). Once its sync is known not to connect, the device remembers
  // it — this visit and the next — until the sync connects.
  it("a sync that never connected is noted on the device, and the note goes when it connects", () => {
    const { result } = renderHook(() => ({ behind: useLocalCopyBehind(), blocked: useSyncBlocked() }));
    act(() => setLocalSyncStatus(synced(false)));
    expect(result.current.blocked).toBe(false);
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS));
    expect(result.current.behind).toBe(true);
    expect(result.current.blocked).toBe(true);
    expect(localStorage.getItem("bizh-sync-blocked")).toBe("1");

    act(() => setLocalSyncStatus(synced(true)));
    expect(result.current.blocked).toBe(false);
    expect(localStorage.getItem("bizh-sync-blocked")).toBeNull();
  });

  it("a sync that connects within the 30 s is never noted", () => {
    const { result } = renderHook(() => useSyncBlocked());
    act(() => setLocalSyncStatus(synced(false)));
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS - 5000));
    act(() => setLocalSyncStatus(synced(true)));
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS));
    expect(result.current).toBe(false);
    expect(localStorage.getItem("bizh-sync-blocked")).toBeNull();
  });

  it("back online starts the count again", () => {
    setOnline(false);
    const { result, rerender } = renderHook(() => useLocalCopyBehind());
    act(() => setLocalSyncStatus(synced(false)));
    act(() => vi.advanceTimersByTime(5 * 60_000));
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    rerender();
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(COPY_BEHIND_AFTER_MS));
    expect(result.current).toBe(true);
  });
});

describe("a page drawn from a copy that's behind", () => {
  const viewer = { userId: "u1", role: "admin", locale: "he" as const };

  it("goes to the server version once the server answers, and says why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    renderHook(() => useLocalCard({ kind: "sales" as never, viewer, page: "sales", serverHref: "/sales?data=server" }));
    act(() => setLocalSyncStatus(synced(false)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_BEHIND_AFTER_MS);
    });
    expect(nav.replace).toHaveBeenCalledWith("/sales?data=server");
    expect(toasts.info).toHaveBeenCalledTimes(1);
  });

  it("keeps the copy when the server doesn't answer either", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    renderHook(() => useLocalCard({ kind: "sales" as never, viewer, page: "projects", serverHref: "/projects?data=server" }));
    act(() => setLocalSyncStatus(synced(false)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_BEHIND_AFTER_MS);
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("a phone opened again after a while in the background stays on its copy while the sync reconnects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    renderHook(() => useLocalCard({ kind: "sales" as never, viewer, page: "dashboard", serverHref: "/dashboard?data=server" }));
    act(() => setLocalSyncStatus(synced(false)));
    setVisible(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40 * 60_000);
    });
    act(() => comeBack());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    act(() => setLocalSyncStatus(synced(true)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_BEHIND_AFTER_MS * 2);
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("a connected copy stays put", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    renderHook(() => useLocalCard({ kind: "sales" as never, viewer, page: "tasks", serverHref: "/tasks?data=server" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_BEHIND_AFTER_MS * 2);
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
