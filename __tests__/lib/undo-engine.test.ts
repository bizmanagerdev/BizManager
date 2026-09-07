import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// sonner's `toast` is callable (`toast(message, opts)`) AND carries methods
// (`toast.success`, `toast.error`, `toast.dismiss`) — mock it as a callable
// function object so both call shapes used by undo-engine.ts work.
const { toastFn, toastSuccess, toastError, toastDismiss } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toastFn, toastSuccess: toastFn.success, toastError: toastFn.error, toastDismiss: toastFn.dismiss };
});

vi.mock("sonner", () => ({ toast: toastFn }));

import {
  scheduleDeferredDelete,
  scheduleDeferredEdit,
  registerReversibleCreate,
  isUndoHidden,
  getUndoPatch,
  undoKey,
  undoLast,
} from "@/lib/undo-engine";

beforeEach(() => {
  vi.useFakeTimers();
  toastFn.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastDismiss.mockClear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("scheduleDeferredDelete", () => {
  it("hides the row immediately (optimistic) and commits after the window elapses", async () => {
    const onCommit = vi.fn().mockResolvedValue({ ok: true });
    scheduleDeferredDelete({ scope: "order", id: "row-1", message: "נמחק", windowMs: 1000, onCommit });

    expect(isUndoHidden("order", "row-1")).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onCommit).toHaveBeenCalledTimes(1);
    // Committed successfully — stays hidden (it's really gone), no revert/error toast.
    expect(isUndoHidden("order", "row-1")).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("undo within the window cancels the commit and un-hides the row", async () => {
    const onCommit = vi.fn().mockResolvedValue({ ok: true });
    scheduleDeferredDelete({ scope: "order", id: "row-2", message: "נמחק", windowMs: 1000, onCommit });
    expect(isUndoHidden("order", "row-2")).toBe(true);

    const undone = undoKey("order:delete:row-2");
    expect(undone).toBe(true);
    expect(isUndoHidden("order", "row-2")).toBe(false);
    expect(toastDismiss).toHaveBeenCalledWith("order:delete:row-2");

    await vi.advanceTimersByTimeAsync(1000);
    expect(onCommit).not.toHaveBeenCalled(); // the timer was cleared, not just ignored
  });

  it("a failed commit reverts the optimistic hide and shows an error toast", async () => {
    const onCommit = vi.fn().mockResolvedValue({ ok: false, error: "network" });
    scheduleDeferredDelete({ scope: "order", id: "row-3", message: "נמחק", windowMs: 1000, onCommit });

    await vi.advanceTimersByTimeAsync(1000);
    expect(isUndoHidden("order", "row-3")).toBe(false); // reverted
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("undoing an already-fired (or unknown) key is a safe no-op", () => {
    expect(undoKey("order:delete:does-not-exist")).toBe(false);
  });
});

describe("scheduleDeferredEdit", () => {
  it("applies the patch optimistically; undo clears it", () => {
    const onCommit = vi.fn().mockResolvedValue({ ok: true });
    scheduleDeferredEdit({
      scope: "expense",
      id: "row-1",
      message: "עודכן",
      patch: { amount: 500 },
      windowMs: 1000,
      onCommit,
    });
    expect(getUndoPatch("expense", "row-1")).toEqual({ amount: 500 });

    undoKey("expense:edit:row-1");
    expect(getUndoPatch("expense", "row-1")).toBeUndefined();
  });
});

describe("registerReversibleCreate — the toast's action/view buttons", () => {
  it("always wires the undo (\"בטל\") action to replay onUndo", () => {
    const onUndo = vi.fn();
    registerReversibleCreate({ scope: "order", id: "new-1", message: "נוצר", onUndo });

    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [, opts] = toastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(opts.action.label).toBe("בטל");

    opts.action.onClick();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("with no `view`, the toast has no cancel/second button", () => {
    registerReversibleCreate({ scope: "order", id: "new-2", message: "נוצר", onUndo: vi.fn() });
    const [, opts] = toastSuccess.mock.calls[0] as [string, { cancel?: unknown }];
    expect(opts.cancel).toBeUndefined();
  });

  it("with `view`, the toast carries a second button that calls view.onClick", () => {
    const onView = vi.fn();
    registerReversibleCreate({
      scope: "order",
      id: "new-3",
      message: "נוצר",
      onUndo: vi.fn(),
      view: { label: "צפייה", onClick: onView },
    });
    const [, opts] = toastSuccess.mock.calls[0] as [
      string,
      { cancel?: { label: string; onClick: () => void } },
    ];
    expect(opts.cancel?.label).toBe("צפייה");
    opts.cancel?.onClick();
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it("undo replays onUndo exactly once even if clicked twice", () => {
    const onUndo = vi.fn();
    registerReversibleCreate({ scope: "customer", id: "new-4", message: "נוצר", onUndo });
    undoKey("customer:create:new-4");
    undoKey("customer:create:new-4");
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe("undoLast", () => {
  it("undoes only the most recently scheduled pending action", () => {
    const onUndoA = vi.fn();
    const onUndoB = vi.fn();
    registerReversibleCreate({ scope: "order", id: "a", message: "A", onUndo: onUndoA });
    registerReversibleCreate({ scope: "order", id: "b", message: "B", onUndo: onUndoB });

    expect(undoLast()).toBe(true);
    expect(onUndoB).toHaveBeenCalledTimes(1);
    expect(onUndoA).not.toHaveBeenCalled();
  });

  it("returns false when nothing is pending", () => {
    // Drain whatever this file's earlier tests left pending.
    vi.runOnlyPendingTimers();
    expect(undoLast()).toBe(false);
  });
});
