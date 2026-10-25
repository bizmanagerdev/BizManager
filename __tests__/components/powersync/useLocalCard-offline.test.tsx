// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

// A device page that can't be drawn from the device, with no connection: its
// server version can't come either — asking for it only reached the service
// worker's "not saved", shown on whatever tab was in front (owner's offline
// test, 2026-10-25: the sales tab's failure as a notice on the customers
// page). The page keeps what it shows, says why (not when it's only slow —
// the device may still answer), keeps a note for the report sent once the
// connection is back, and goes to the server version then — unless the
// device has drawn it meanwhile.

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, refresh: () => {} }) }));
const toasts = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: toasts.info } }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));
const notes = vi.hoisted(() => ({ noteOffline: vi.fn() }));
vi.mock("@/lib/pwa/offline-report", () => ({ noteOffline: notes.noteOffline }));
const device = vi.hoisted(() => ({
  handlers: null as null | { onData: (data: unknown, json: string, ms: number) => void; onError: (reason: string, error?: unknown) => void },
}));
vi.mock("@/lib/powersync/local-results", () => ({
  peekResult: () => null,
  resultKey: ({ kind }: { kind: string }) => `k:${kind}`,
  watchResult: (_db: unknown, _spec: unknown, handlers: NonNullable<typeof device.handlers>) => {
    device.handlers = handlers;
    return () => {};
  },
}));

import { setLocalDatabase, setLocalSyncStatus } from "@/lib/powersync/store";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import type { CommonPowerSyncDatabase } from "@powersync/web";

const synced = {
  connected: false,
  connecting: false,
  hasSynced: true,
  lastSyncedAt: null,
  downloading: false,
  uploading: false,
  error: null,
};

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

const viewer = { userId: "u1", role: "admin", locale: "he" as const };
let kindCount = 0;

/** A page of its own each time: the hook keeps per-page notes for the session. */
function openPage() {
  kindCount += 1;
  const page = `sales-${kindCount}`;
  const hook = renderHook(() =>
    useLocalCard({ kind: "salesOrders", viewer, page, serverHref: "/sales?data=server", filters: { n: kindCount } })
  );
  return { hook, page };
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(false);
  nav.replace.mockReset();
  toasts.info.mockReset();
  notes.noteOffline.mockReset();
  device.handlers = null;
  setLocalDatabase({} as CommonPowerSyncDatabase);
  setLocalSyncStatus(synced);
});
afterEach(() => {
  setLocalSyncStatus(null);
  setLocalDatabase(null);
  localStorage.clear();
  vi.useRealTimers();
});

describe("a device page with no connection", () => {
  it("the device's work failed: stays, says so, keeps a note — and goes to the server version when the connection is back", () => {
    const { page } = openPage();
    act(() => device.handlers!.onError("error", new Error("database is locked")));
    expect(nav.replace).not.toHaveBeenCalled();
    expect(toasts.info).toHaveBeenCalledWith("הדף לא נטען מהמכשיר — ייטען כשיחזור החיבור", { id: "device-page-offline" });
    expect(notes.noteOffline).toHaveBeenCalledWith("device page failed", {
      pageKind: page,
      reason: "error",
      message: "database is locked",
    });

    setOnline(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(nav.replace).toHaveBeenCalledWith("/sales?data=server");
  });

  it("only slow: nothing said (the device may still answer), and once it has, the connection coming back changes nothing", () => {
    openPage();
    act(() => vi.advanceTimersByTime(8000));
    expect(toasts.info).not.toHaveBeenCalled();
    expect(notes.noteOffline).toHaveBeenCalledWith("device page failed", expect.objectContaining({ reason: "slow" }));
    expect(nav.replace).not.toHaveBeenCalled();

    act(() => device.handlers!.onData({ rows: [] }, "{}", 12));
    setOnline(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("the same page failing again before the connection is back: said and noted once", () => {
    openPage();
    act(() => device.handlers!.onError("error", new Error("x")));
    act(() => device.handlers!.onError("error", new Error("x")));
    expect(toasts.info).toHaveBeenCalledTimes(1);
    expect(notes.noteOffline).toHaveBeenCalledTimes(1);
  });

  it("online, as before: the server version at once", () => {
    setOnline(true);
    openPage();
    act(() => device.handlers!.onError("error", new Error("x")));
    expect(nav.replace).toHaveBeenCalledWith("/sales?data=server");
    expect(notes.noteOffline).not.toHaveBeenCalled();
  });
});
