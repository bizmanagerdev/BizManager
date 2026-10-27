// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// The menu's device pages are saved to open with no connection — each one the
// service worker hasn't saved since the last update — once the page has
// settled. Once per tab per service worker version, and only while the
// device's copy is complete and syncing: otherwise the server sends the
// pages' server version, which isn't saved (owner, 2026-10-24).

const h = vi.hoisted(() => ({
  status: null as { hasSynced: boolean } | null,
  blocked: false,
  save: vi.fn(),
  saveApp: vi.fn(),
}));
const net = vi.hoisted(() => ({ up: true }));
vi.mock("@/lib/pwa/connection", () => ({
  isServerReachable: () => net.up,
  useServerReachable: () => net.up,
  whenServerReachable: () => () => {},
  watchConnection: () => () => {},
}));
vi.mock("@/lib/powersync/store", () => ({
  useLocalSyncStatus: () => h.status,
  useSyncBlocked: () => h.blocked,
}));
vi.mock("@/lib/powersync/device-frames", () => ({
  menuFramePaths: () => ["/dashboard", "/tasks"],
  saveDeviceFrames: h.save,
  saveAppCode: h.saveApp,
}));

import OfflineMenuFrames from "@/components/powersync/OfflineMenuFrames";

const sw = new EventTarget() as EventTarget & { controller: { scriptURL: string } | null };
const viewer = { userId: "a1", role: "admin", locale: "he" as const };

describe("saving the menu's pages for offline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.status = { hasSynced: true };
    h.blocked = false;
    h.save.mockReset();
    h.saveApp.mockReset();
    net.up = true;
    sessionStorage.clear();
    sw.controller = { scriptURL: "https://www.biz-h.com/sw.js?v=b1" };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("after the page has settled: asks for the menu's pages, once per tab and version", () => {
    render(<OfflineMenuFrames viewer={viewer} />);
    expect(h.save).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(8000));
    expect(h.save).toHaveBeenCalledWith(["/dashboard", "/tasks"]);
    // And the whole app's code with them (2026-10-27).
    expect(h.saveApp).toHaveBeenCalledTimes(1);

    cleanup();
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(8000));
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it("a new version taking over: asked again (its saved pages are only its own build's)", () => {
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(8000));
    sw.controller = { scriptURL: "https://www.biz-h.com/sw.js?v=b2" };
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
      vi.advanceTimersByTime(8000);
    });
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("not while the copy is still downloading, nor while its sync is blocked", () => {
    h.status = { hasSynced: false };
    const { rerender } = render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(8000));
    h.status = { hasSynced: true };
    h.blocked = true;
    rerender(<OfflineMenuFrames viewer={{ ...viewer }} />);
    act(() => vi.advanceTimersByTime(8000));
    expect(h.save).not.toHaveBeenCalled();
  });

  it("no connection at that moment: not marked done — asked on a later opening", () => {
    net.up = false;
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(8000));
    expect(h.save).not.toHaveBeenCalled();
    net.up = true;
    cleanup();
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(8000));
    expect(h.save).toHaveBeenCalledTimes(1);
  });
});
