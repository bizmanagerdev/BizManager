// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTransportWatch,
  rememberTransport,
  storedTransport,
  SWITCH_AFTER_FAILURES,
  watchStoredTransport,
} from "@/lib/powersync/sync-transport";

// The office computer's filter broke the sync's WebSocket over and over, and
// its copy stopped getting new rows (2026-10-12). After a few failed
// connections in a row the device tries plain HTTP streaming instead — once a
// session — and remembers what it switched to.

describe("the sync's way of connecting", () => {
  beforeEach(() => localStorage.clear());

  it("starts on the WebSocket; a remembered HTTP stream holds for a week", () => {
    expect(storedTransport()).toBe("web-socket");
    const at = Date.UTC(2026, 9, 12);
    rememberTransport("http", at);
    expect(storedTransport(at + 6 * 24 * 3600_000)).toBe("http");
    expect(storedTransport(at + 8 * 24 * 3600_000)).toBe("web-socket");
    rememberTransport("web-socket", at);
    expect(storedTransport(at)).toBe("web-socket");
  });

  it(`switches after ${SWITCH_AFTER_FAILURES} failed connections in a row, and remembers it`, () => {
    const onSwitch = vi.fn();
    const watch = createTransportWatch("web-socket", onSwitch);
    watch.failed(0);
    watch.failed(5_000);
    expect(onSwitch).not.toHaveBeenCalled();
    watch.failed(10_000);
    expect(onSwitch).toHaveBeenCalledWith("http");
    expect(watch.transport).toBe("http");
    expect(storedTransport(10_000)).toBe("http");
  });

  it("one failure logged as several lines counts once", () => {
    const onSwitch = vi.fn();
    const watch = createTransportWatch("web-socket", onSwitch);
    // "Sync error" + "Failed to connect WebSocket" + the status — the same failure.
    watch.failed(0);
    watch.failed(300);
    watch.failed(900);
    watch.failed(5_000);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("a connection that works starts the count over", () => {
    const onSwitch = vi.fn();
    const watch = createTransportWatch("web-socket", onSwitch);
    watch.failed(0);
    watch.failed(5_000);
    watch.connected();
    watch.failed(10_000);
    watch.failed(15_000);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("switches only once a session — two ways that both fail don't take turns forever", () => {
    const onSwitch = vi.fn();
    const watch = createTransportWatch("web-socket", onSwitch);
    for (let i = 0; i < 12; i++) watch.failed(i * 5_000);
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  // Every tab shares one connection: on 2026-10-18 four tabs on the owner's
  // computer switched it in the same second, pulling it different ways, after
  // failures logged while the computer slept. One decision for all of them.
  describe("tabs share one decision", () => {
    it("a tab that may not decide (in the background, offline) never counts or switches", () => {
      const onSwitch = vi.fn();
      const watch = createTransportWatch("web-socket", onSwitch, () => false);
      for (let i = 0; i < 10; i++) watch.failed(i * 5_000);
      expect(onSwitch).not.toHaveBeenCalled();
      expect(watch.transport).toBe("web-socket");
    });

    it("a tab takes another tab's way without reconnecting, and doesn't switch again this session", () => {
      const onSwitch = vi.fn();
      const watch = createTransportWatch("web-socket", onSwitch);
      watch.adopt("http");
      expect(watch.transport).toBe("http");
      for (let i = 0; i < 6; i++) watch.failed(i * 5_000);
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it("the count starts over after the device was away (asleep, offline, off screen)", () => {
      const onSwitch = vi.fn();
      const watch = createTransportWatch("web-socket", onSwitch);
      watch.failed(0);
      watch.failed(5_000);
      watch.reset();
      watch.failed(10_000);
      watch.failed(15_000);
      expect(onSwitch).not.toHaveBeenCalled();
      watch.failed(20_000);
      expect(onSwitch).toHaveBeenCalledWith("http");
    });

    it("the other tabs hear of a switch", () => {
      const heard = vi.fn();
      const stop = watchStoredTransport(heard);
      rememberTransport("http");
      window.dispatchEvent(new StorageEvent("storage", { key: "bizh-sync-transport" }));
      expect(heard).toHaveBeenLastCalledWith("http");
      rememberTransport("web-socket");
      window.dispatchEvent(new StorageEvent("storage", { key: "bizh-sync-transport" }));
      expect(heard).toHaveBeenLastCalledWith("web-socket");
      window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
      expect(heard).toHaveBeenCalledTimes(2);
      stop();
      window.dispatchEvent(new StorageEvent("storage", { key: "bizh-sync-transport" }));
      expect(heard).toHaveBeenCalledTimes(2);
    });
  });

  it("a device on HTTP that keeps failing goes back to the WebSocket", () => {
    const onSwitch = vi.fn();
    const watch = createTransportWatch("http", onSwitch);
    for (let i = 0; i < SWITCH_AFTER_FAILURES; i++) watch.failed(i * 5_000);
    expect(onSwitch).toHaveBeenCalledWith("web-socket");
    expect(storedTransport()).toBe("web-socket");
  });
});
