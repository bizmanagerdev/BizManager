// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A property's page after a save (owner's offline test, 2026-10-25: an expense
// added with no connection, then "אירעה תקלה בטעינת הדף"): the page isn't asked
// of the server while a save waits on the device — Next.js would load it whole,
// from the saved copy — and reads itself again once the waiting saves go out.

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

import { useOfflineSafeRefresh } from "@/hooks/useOfflineSafeRefresh";
import { CONNECTION_EVENTS, offlineFetch } from "@/lib/offline-queue";

let online = true;

beforeEach(() => {
  localStorage.clear();
  routerRefresh.mockClear();
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
});

afterEach(() => vi.unstubAllGlobals());

describe("the page read again after a save", () => {
  it("nothing waiting: read again", async () => {
    const { result } = renderHook(() => useOfflineSafeRefresh());
    act(() => result.current());
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
  });

  it("no connection: not asked of the server", async () => {
    online = false;
    const { result } = renderHook(() => useOfflineSafeRefresh());
    act(() => result.current());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("a save still waiting on the device (the connection that hangs, the device saying it's online): not either", async () => {
    online = false;
    expect(await offlineFetch("/api/expenses/create", { amount: 1 }, "הוצאה חדשה", { idempotent: true })).toMatchObject({
      queued: true,
    });
    online = true;
    const { result } = renderHook(() => useOfflineSafeRefresh());
    act(() => result.current());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("the waiting saves went out: read again — not by a dialog whose page already does", async () => {
    const page = renderHook(() => useOfflineSafeRefresh());
    const dialog = renderHook(() => useOfflineSafeRefresh({ whenSent: false }));
    act(() => {
      window.dispatchEvent(new CustomEvent(CONNECTION_EVENTS.synced, { detail: { count: 1 } }));
    });
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
    page.unmount();
    dialog.unmount();
  });
});
