// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// The red "no connection" bar follows whether the server answers, not what the
// device claims: a laptop with another network adapter up says it's online
// with its Wi-Fi off, and no bar showed (owner's test, 2026-10-27). When the
// server answers again, what waits is sent — without the device ever having
// said it was offline.

const h = vi.hoisted(() => ({ up: true, processQueue: vi.fn(async () => ({ processed: 0, failed: 0 })) }));
vi.mock("@/lib/pwa/connection", () => ({ useServerReachable: () => h.up }));
vi.mock("@/lib/offline-queue", () => ({
  getQueueLength: () => 0,
  getFailedLength: () => 0,
  processQueue: h.processQueue,
  retryFailed: () => {},
  clearFailed: () => {},
  CONNECTION_EVENTS: { changed: "bizh:connection-changed" },
}));
vi.mock("@/lib/offline-upload", () => ({
  getUploadQueueLength: async () => 0,
  getUploadFailedLength: async () => 0,
  processUploadQueue: async () => {},
  retryFailedUploads: async () => {},
  clearFailedUploads: async () => {},
}));
vi.mock("@/lib/powersync/device-saves-waiting", () => ({ useDeviceSavesWaiting: () => ({ count: 0, stuck: false }) }));
vi.mock("@/components/layout/PendingSyncPanel", () => ({ default: () => null }));

import OfflineBanner from "@/components/layout/OfflineBanner";

afterEach(() => {
  cleanup();
  h.processQueue.mockClear();
});

describe("the no-connection bar", () => {
  it("shows when the server doesn't answer, though the device says it's online", () => {
    h.up = false;
    render(<OfflineBanner />);
    expect(screen.getByText(/אין חיבור לאינטרנט/)).toBeTruthy();
  });

  it("goes when the server answers — and sends what waits", async () => {
    h.up = false;
    const { rerender } = render(<OfflineBanner />);
    // The send tried as the page opened has finished.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    h.processQueue.mockClear();
    h.up = true;
    rerender(<OfflineBanner />);
    expect(screen.queryByText(/אין חיבור לאינטרנט/)).toBeNull();
    expect(h.processQueue).toHaveBeenCalled();
  });
});
