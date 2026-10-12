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

import { COPY_BEHIND_AFTER_MS, setLocalSyncStatus, useLocalCopyBehind } from "@/lib/powersync/store";
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

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  nav.replace.mockReset();
  toasts.info.mockReset();
  setLocalSyncStatus(synced(true));
});
afterEach(() => {
  setLocalSyncStatus(null);
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

  it("a connected copy stays put", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    renderHook(() => useLocalCard({ kind: "sales" as never, viewer, page: "tasks", serverHref: "/tasks?data=server" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_BEHIND_AFTER_MS * 2);
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
