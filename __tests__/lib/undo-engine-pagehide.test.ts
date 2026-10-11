// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { toastFn } = vi.hoisted(() => ({
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastFn }));

import { scheduleDeferredDelete, undoKey } from "@/lib/undo-engine";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// Offline, a navigation reloads the whole page and the window's timer died
// with it — a delete that had said "נמחק" never happened (2026-10-11).
describe("leaving the page", () => {
  it("commits a pending deferred action at once instead of dropping it", async () => {
    const onCommit = vi.fn().mockResolvedValue({ ok: true });
    scheduleDeferredDelete({ scope: "order", id: "row-hide", message: "נמחק", windowMs: 10000, onCommit });
    expect(onCommit).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(onCommit).toHaveBeenCalledTimes(1);

    // …and only once: the window's own timer no longer fires it again.
    await vi.advanceTimersByTimeAsync(10000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("doesn't commit one that was undone", async () => {
    const onCommit = vi.fn().mockResolvedValue({ ok: true });
    scheduleDeferredDelete({ scope: "order", id: "row-undone", message: "נמחק", windowMs: 10000, onCommit });
    undoKey("order:delete:row-undone");
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
