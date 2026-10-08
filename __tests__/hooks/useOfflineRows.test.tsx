// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// A list kept for when there's no signal (the projects tab, the open orders)
// is served only for that same list — switching to another tab offline
// (owner's walkthrough, 2026-10-08: the quotes tab showed the projects tab's
// old cards) shows that tab's own rows.

const { loadSnapshot } = vi.hoisted(() => ({ loadSnapshot: vi.fn() }));
vi.mock("@/lib/offline-cache", () => ({ loadSnapshot, saveSnapshot: vi.fn(async () => {}) }));

import { useOfflineRows } from "@/hooks/useOfflineRows";

function goOffline() {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
  window.dispatchEvent(new Event("offline"));
}

const kept = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];

beforeEach(() => {
  loadSnapshot.mockReset();
  loadSnapshot.mockResolvedValue({ data: kept, savedAt: 1 });
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
});

describe("useOfflineRows", () => {
  it("offline, the kept list is served for its own list", async () => {
    const { result } = renderHook(({ key, rows }) => useOfflineRows(key, rows), {
      initialProps: { key: "projects-list-main" as string | null, rows: [{ id: "p1" }] },
    });
    act(() => goOffline());
    await waitFor(() => expect(result.current.rows).toEqual(kept));
  });

  it("…but not after switching to another tab (no key): that tab's own rows", async () => {
    const { result, rerender } = renderHook(({ key, rows }) => useOfflineRows(key, rows), {
      initialProps: { key: "projects-list-main" as string | null, rows: [{ id: "p1" }] },
    });
    act(() => goOffline());
    await waitFor(() => expect(result.current.rows).toEqual(kept));
    rerender({ key: null, rows: [{ id: "quote-1" }] });
    expect(result.current.rows).toEqual([{ id: "quote-1" }]);
    expect(result.current.offline).toBe(true);
  });
});
