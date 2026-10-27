// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A save the queue gives up on is reported with what it was and why — the
// report used to say only "1" (סאלח's phone, 24–25/10), and finding which
// save took the server's logs. Never its content.

let online = true;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("a save given up on", () => {
  it("says which save, where it went, the server's answer and why", async () => {
    const queue = await import("@/lib/offline-queue");
    queue.enqueue({
      url: "/api/attendance/my/close",
      body: { notes: "בית שמש", clock_out: "2026-10-22T19:41:23.853Z" },
      label: "סיום המשמרת",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "אין לך משמרת פתוחה." }), { status: 404 }))
    );
    const failed = vi.fn();
    window.addEventListener(queue.CONNECTION_EVENTS.failed, (event) => failed((event as CustomEvent).detail));

    const result = await queue.processQueue();

    expect(result.failed).toBe(1);
    expect(failed).toHaveBeenCalledWith({
      count: 1,
      items: [{ label: "סיום המשמרת", path: "/api/attendance/my/close", status: 404, error: "אין לך משמרת פתוחה." }],
    });
    // The note carries no part of what was saved.
    expect(JSON.stringify(failed.mock.calls[0][0])).not.toContain("בית שמש");
  });
});
