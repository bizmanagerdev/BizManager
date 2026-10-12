// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTransportWatch, rememberTransport, storedTransport, SWITCH_AFTER_FAILURES } from "@/lib/powersync/sync-transport";

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

  it("a device on HTTP that keeps failing goes back to the WebSocket", () => {
    const onSwitch = vi.fn();
    const watch = createTransportWatch("http", onSwitch);
    for (let i = 0; i < SWITCH_AFTER_FAILURES; i++) watch.failed(i * 5_000);
    expect(onSwitch).toHaveBeenCalledWith("web-socket");
    expect(storedTransport()).toBe("web-socket");
  });
});
