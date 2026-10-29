// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

// The payments calendar's windows close only once the board shows the change
// (owner, 2026-10-04: "I can't have it close without the change on the page
// already"). On the server version that's the router's refresh landing; on the
// device version (2026-10-29) the save comes back through the device copy,
// which draws the board again — a refresh would answer before that.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const warning = vi.fn();
vi.mock("sonner", () => ({ toast: { warning: (...args: unknown[]) => warning(...args) } }));
let reachable = true;
vi.mock("@/lib/pwa/connection", () => ({ isServerReachable: () => reachable }));

import { DeviceBoardData, useRefreshAndWait } from "@/app/(app)/financial/payments-calendar/useRefreshAndWait";

function onDevice(initial: unknown) {
  let data = initial;
  const wrapper = ({ children }: { children: ReactNode }) => <DeviceBoardData.Provider value={data}>{children}</DeviceBoardData.Provider>;
  const hook = renderHook(() => useRefreshAndWait(), { wrapper });
  return {
    hook,
    /** The device copy hands the board new data. */
    nextData(value: unknown) {
      data = value;
      hook.rerender();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  warning.mockClear();
  reachable = true;
});
afterEach(() => vi.useRealTimers());

describe("the board's wait after a save, on the device version", () => {
  it("is released by the board's next data from the copy — and asks the server for no refresh", async () => {
    const board = onDevice({ items: ["before"] });
    let released = false;
    act(() => {
      void board.hook.result.current.refreshAndWait().then(() => (released = true));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(released).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      board.nextData({ items: ["after"] });
      await Promise.resolve();
    });
    expect(released).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  });

  it("lets the window go after 6 s if the copy hasn't brought the change, and says so", async () => {
    const board = onDevice({ items: [] });
    let released = false;
    act(() => {
      void board.hook.result.current.refreshAndWait().then(() => (released = true));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(released).toBe(true);
    expect(warning).toHaveBeenCalledWith("השינוי נשמר — הלוח יתעדכן ברגע שהעותק במכשיר יקבל אותו");
  });

  it("with no server, doesn't wait at all", async () => {
    reachable = false;
    const board = onDevice({ items: [] });
    let released = false;
    await act(async () => {
      await board.hook.result.current.refreshAndWait().then(() => (released = true));
    });
    expect(released).toBe(true);
    expect(warning).toHaveBeenCalledWith("אין חיבור — הלוח יתעדכן כשהחיבור יחזור");
  });
});

describe("on the server version", () => {
  it("refreshes the page from the server", () => {
    const { result } = renderHook(() => useRefreshAndWait());
    act(() => {
      void result.current.refreshAndWait();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
