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
  paths: ["/dashboard", "/tasks"],
  save: vi.fn(),
  saveApp: vi.fn(),
}));
// whenServerReachable: at once while the server answers, else once it does (serverAnswers).
const net = vi.hoisted(() => ({ up: true, waiting: [] as (() => void)[] }));
vi.mock("@/lib/pwa/connection", () => ({
  isServerReachable: () => net.up,
  useServerReachable: () => net.up,
  whenServerReachable: (callback: () => void) => {
    if (net.up) {
      callback();
      return () => {};
    }
    net.waiting.push(callback);
    return () => {
      net.waiting = net.waiting.filter((waiting) => waiting !== callback);
    };
  },
  watchConnection: () => () => {},
}));
vi.mock("@/lib/powersync/store", () => ({
  useLocalSyncStatus: () => h.status,
  useSyncBlocked: () => h.blocked,
}));
vi.mock("@/lib/powersync/device-frames", () => ({
  menuFramePaths: () => h.paths,
  saveDeviceFrames: h.save,
  saveAppCode: h.saveApp,
}));

import OfflineMenuFrames from "@/components/powersync/OfflineMenuFrames";

const sw = new EventTarget() as EventTarget & { controller: { scriptURL: string } | null };
const viewer = { userId: "a1", role: "admin", locale: "he" as const };

function serverAnswers() {
  net.up = true;
  const waiting = net.waiting;
  net.waiting = [];
  for (const callback of waiting) callback();
}

function reset() {
  h.status = { hasSynced: true };
  h.blocked = false;
  h.paths = ["/dashboard", "/tasks"];
  h.save.mockReset();
  h.saveApp.mockReset();
  net.up = true;
  net.waiting = [];
  sessionStorage.clear();
  sw.controller = { scriptURL: "https://www.biz-h.com/sw.js?v=b1" };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
}

describe("saving the menu's pages for offline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    reset();
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

// The whole app's code needs no copy (owner, 2026-10-27: "download the app's
// code once the copy has synced, or a few minutes after the app opens if it
// hasn't"): a new device, a sync refused or blocked by the network, never got
// it before — and a form never opened couldn't open offline.

describe("the whole app's code", () => {
  const MINUTE = 60 * 1000;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // The app opened just now (the page load the count starts from).
    vi.setSystemTime(performance.timeOrigin);
    reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("with no ready copy: asked 3 minutes after the app opened — the menu's pages still not", () => {
    h.status = { hasSynced: false };
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(3 * MINUTE - 1000));
    expect(h.saveApp).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(h.saveApp).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("a sync that's blocked counts as no ready copy", () => {
    h.blocked = true;
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(8000));
    expect(h.saveApp).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(3 * MINUTE));
    expect(h.saveApp).toHaveBeenCalledTimes(1);
  });

  it("counted from the app's opening: a page moved to 2½ minutes in asks 30 s later", () => {
    h.status = { hasSynced: false };
    vi.setSystemTime(performance.timeOrigin + 2.5 * MINUTE);
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(30 * 1000));
    expect(h.saveApp).toHaveBeenCalledTimes(1);
  });

  it("the server not answering then: asked once it answers", () => {
    h.status = { hasSynced: false };
    net.up = false;
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(3 * MINUTE));
    expect(h.saveApp).not.toHaveBeenCalled();
    act(() => serverAnswers());
    expect(h.saveApp).toHaveBeenCalledTimes(1);
  });

  it("the copy ready after the code was asked: the menu's pages are asked, the code not again", () => {
    h.status = { hasSynced: false };
    const { rerender } = render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(3 * MINUTE));
    expect(h.saveApp).toHaveBeenCalledTimes(1);
    h.status = { hasSynced: true };
    rerender(<OfflineMenuFrames viewer={{ ...viewer }} />);
    act(() => vi.advanceTimersByTime(8000));
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.saveApp).toHaveBeenCalledTimes(1);
  });

  it("no menu pages to save (a worker reading Arabic): the code still comes with the ready copy", () => {
    h.paths = [];
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(8000));
    expect(h.save).not.toHaveBeenCalled();
    expect(h.saveApp).toHaveBeenCalledTimes(1);
  });

  it("a new version taking over: its code is asked for too", () => {
    render(<OfflineMenuFrames viewer={viewer} />);
    act(() => vi.advanceTimersByTime(8000));
    sw.controller = { scriptURL: "https://www.biz-h.com/sw.js?v=b2" };
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
      vi.advanceTimersByTime(8000);
    });
    expect(h.saveApp).toHaveBeenCalledTimes(2);
  });
});
