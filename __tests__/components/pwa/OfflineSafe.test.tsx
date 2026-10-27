// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// A part of the app whose code loads when it's needed (the "+" forms): if
// that code can't be had with no connection, that part alone gives way — not
// the whole app (owner's test, 2026-10-27: hovering "+" offline, then
// "אירעה שגיאה") — and it's tried again once the server answers. With the
// server answering it's a real failure: reported, never retried in a loop.

const h = vi.hoisted(() => {
  const waiting = new Set<() => void>();
  return {
    up: false,
    waiting,
    captureException: vi.fn(),
    noteOffline: vi.fn(),
    reloadIfStaleBuild: vi.fn(),
  };
});
vi.mock("@/lib/pwa/connection", () => ({
  isServerReachable: () => h.up,
  whenServerReachable: (callback: () => void) => {
    h.waiting.add(callback);
    return () => h.waiting.delete(callback);
  },
}));
vi.mock("@/lib/pwa/offline-report", () => ({ noteOffline: h.noteOffline }));
vi.mock("@/lib/sentry-lazy", () => ({
  withSentry: (report: (sentry: { captureException: typeof h.captureException }) => void) =>
    report({ captureException: h.captureException }),
}));
vi.mock("@/lib/ui/auto-recover", () => ({ reloadIfStaleBuild: h.reloadIfStaleBuild }));

import OfflineSafe from "@/components/pwa/OfflineSafe";

let codeOnDevice = false;
function TheForms() {
  if (!codeOnDevice) throw new Error("Failed to load chunk /_next/static/chunks/quick-create.js");
  return <p>הטפסים</p>;
}

beforeEach(() => {
  codeOnDevice = false;
  h.waiting.clear();
  h.captureException.mockReset();
  h.noteOffline.mockReset();
  h.reloadIfStaleBuild.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a part of the app whose code can't load", () => {
  it("with no connection: only that part gives way, a note is kept, and it's tried again once the server answers", () => {
    h.up = false;
    render(
      <div>
        <p>הדף</p>
        <OfflineSafe name="quick-create" fallback={<p>לא זמין</p>}>
          <TheForms />
        </OfflineSafe>
      </div>
    );
    expect(screen.getByText("הדף")).toBeTruthy();
    expect(screen.getByText("לא זמין")).toBeTruthy();
    expect(h.noteOffline).toHaveBeenCalledWith(
      "part failed",
      expect.objectContaining({ part: "quick-create", message: expect.stringContaining("quick-create.js") })
    );
    expect(h.captureException).not.toHaveBeenCalled();

    codeOnDevice = true;
    act(() => {
      for (const callback of [...h.waiting]) callback();
    });
    expect(screen.getByText("הטפסים")).toBeTruthy();
  });

  it("with the server answering: reported, a stale build reloads — and it isn't retried in a loop", () => {
    h.up = true;
    render(
      <OfflineSafe name="quick-create">
        <TheForms />
      </OfflineSafe>
    );
    expect(h.captureException).toHaveBeenCalledTimes(1);
    expect(h.reloadIfStaleBuild).toHaveBeenCalledTimes(1);
    expect(h.waiting.size).toBe(0);
    expect(h.noteOffline).not.toHaveBeenCalled();
  });
});
