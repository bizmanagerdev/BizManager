// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Whether the server answers — not what the device claims. A laptop with
// another network adapter up says it's online with its Wi-Fi off (owner's
// test, 2026-10-27: no "no connection" bar, and the device pages asked the
// server they couldn't reach). Down when the device says so, or when the
// service worker saw a request fail and a ping confirms it; up again when a
// request goes through or a ping answers (every 5 s while down).

const ping = vi.fn(async () => new Response(null, { status: 204 }));
const worker = new EventTarget();

async function load() {
  vi.resetModules();
  return import("@/lib/pwa/connection");
}

function workerSays(online: boolean) {
  worker.dispatchEvent(new MessageEvent("message", { data: { type: "CONNECTION", online } }));
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  ping.mockReset().mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", ping);
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
  delete document.documentElement.dataset.bizhSaved;
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("does the server answer", () => {
  it("a failed request the worker saw: down only once a ping fails too — a cancelled request isn't an outage", async () => {
    const connection = await load();
    const stop = connection.watchConnection();
    workerSays(false);
    await settle();
    expect(connection.isServerReachable()).toBe(true);

    ping.mockRejectedValue(new TypeError("Failed to fetch"));
    workerSays(false);
    await settle();
    expect(connection.isServerReachable()).toBe(false);
    stop();
  });

  it("down: checked every 5 seconds, and up the moment the server answers — the device never said a word", async () => {
    const connection = await load();
    const stop = connection.watchConnection();
    ping.mockRejectedValue(new TypeError("Failed to fetch"));
    workerSays(false);
    await settle();
    expect(connection.isServerReachable()).toBe(false);

    const back = vi.fn();
    connection.whenServerReachable(back);
    ping.mockResolvedValue(new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(connection.isServerReachable()).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a request the worker saw go through: up at once", async () => {
    const connection = await load();
    const stop = connection.watchConnection();
    ping.mockRejectedValue(new TypeError("Failed to fetch"));
    workerSays(false);
    await settle();
    workerSays(true);
    expect(connection.isServerReachable()).toBe(true);
    stop();
  });

  it("the device saying it's offline is believed at once", async () => {
    const connection = await load();
    const stop = connection.watchConnection();
    window.dispatchEvent(new Event("offline"));
    expect(connection.isServerReachable()).toBe(false);
    stop();
  });

  it("a page the worker answered with a saved copy starts as not answering, until a ping says otherwise", async () => {
    document.documentElement.dataset.bizhSaved = String(Date.now());
    const connection = await load();
    expect(connection.isServerReachable()).toBe(false);
    const stop = connection.watchConnection();
    await settle();
    expect(connection.isServerReachable()).toBe(true);
    stop();
  });

  it("the next page starts as not answering when the last one ended that way — and a ping at once finds out", async () => {
    let connection = await load();
    let stop = connection.watchConnection();
    window.dispatchEvent(new Event("offline"));
    stop();
    // The next page (offline, every page change loads one whole): no bar going and coming back.
    ping.mockRejectedValue(new TypeError("Failed to fetch"));
    connection = await load();
    expect(connection.isServerReachable()).toBe(false);
    stop = connection.watchConnection();
    await settle();
    expect(ping).toHaveBeenCalledTimes(1);
    expect(connection.isServerReachable()).toBe(false);
    stop();

    // The server answering again: the next page starts as answering.
    ping.mockResolvedValue(new Response(null, { status: 204 }));
    connection = await load();
    stop = connection.watchConnection();
    await settle();
    expect(connection.isServerReachable()).toBe(true);
    stop();
    connection = await load();
    expect(connection.isServerReachable()).toBe(true);
  });

  it("a note of the server not answering from long ago says nothing about now", async () => {
    localStorage.setItem("bizh-server-down", String(Date.now() - 11 * 60 * 1000));
    const connection = await load();
    expect(connection.isServerReachable()).toBe(true);
  });

  it("waiting for the server: run at once if it answers now, else once it does — and can be called off", async () => {
    const connection = await load();
    const now = vi.fn();
    connection.whenServerReachable(now);
    expect(now).toHaveBeenCalledTimes(1);

    const stop = connection.watchConnection();
    window.dispatchEvent(new Event("offline"));
    const later = vi.fn();
    const calledOff = vi.fn();
    connection.whenServerReachable(later);
    connection.whenServerReachable(calledOff)();
    workerSays(true);
    expect(later).toHaveBeenCalledTimes(1);
    expect(calledOff).not.toHaveBeenCalled();
    stop();
  });
});
