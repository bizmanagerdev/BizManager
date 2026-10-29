// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The device copy's sync connection dropping is often the first sign the
// server is gone: a page drawn from the device asks the server nothing — a
// month changed on the cash-flow page — so the "no connection" bar waited for
// the next page (owner's Wi-Fi-off test, 2026-10-29). Each drop asks
// lib/pwa/connection.ts to check (syncConnectionDropped).

const engine = vi.hoisted(() => ({ statusChanged: null as ((status: Record<string, unknown>) => void) | null }));
const net = vi.hoisted(() => ({ dropped: vi.fn() }));

vi.mock("@powersync/web", () => ({
  LogLevels: { info: 2, error: 4 },
  SyncStreamConnectionMethod: { HTTP: "http", WEB_SOCKET: "web-socket" },
  WASQLiteVFS: { OPFSCoopSyncVFS: "OPFSCoopSyncVFS", IDBBatchAtomicVFS: "IDBBatchAtomicVFS" },
  PowerSyncDatabase: class {
    currentStatus = { connected: false, connecting: true, hasSynced: true };
    async init() {}
    registerListener(listener: { statusChanged: (status: Record<string, unknown>) => void }) {
      engine.statusChanged = listener.statusChanged;
      return () => {};
    }
    async connect() {}
  },
}));
vi.mock("@/lib/powersync/connector", () => ({ BizConnector: class {} }));
vi.mock("@/lib/powersync/schema", () => ({ AppSchema: {} }));
vi.mock("@/lib/powersync/config", () => ({ POWERSYNC_ASSETS_BASE: "/powersync" }));
vi.mock("@/lib/powersync/store", () => ({ setLocalDatabase: () => {}, setLocalSyncStatus: () => {} }));
vi.mock("@/lib/powersync/sync-transport", () => ({
  createTransportWatch: () => ({ transport: "websocket", connected: () => {}, failed: () => {}, reset: () => {}, adopt: () => {} }),
  storedTransport: () => "websocket",
  watchStoredTransport: () => () => {},
}));
vi.mock("@/lib/pwa/connection", () => ({ isServerReachable: () => true, syncConnectionDropped: net.dropped }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

import { openLocalDatabase } from "@/lib/powersync/database";

const status = (connected: boolean) => ({ connected, connecting: !connected, hasSynced: true, downloading: false, uploading: false });

beforeEach(async () => {
  net.dropped.mockReset();
  await openLocalDatabase("auth-owner");
});

describe("the sync connection dropping", () => {
  it("connected, then not: the server is checked once", () => {
    engine.statusChanged?.(status(true));
    engine.statusChanged?.(status(true));
    expect(net.dropped).not.toHaveBeenCalled();
    engine.statusChanged?.(status(false));
    expect(net.dropped).toHaveBeenCalledTimes(1);
    // Its retries every 5 s (still not connected) aren't new drops.
    engine.statusChanged?.(status(false));
    engine.statusChanged?.(status(false));
    expect(net.dropped).toHaveBeenCalledTimes(1);
  });

  it("back, and dropped again: checked again", () => {
    engine.statusChanged?.(status(true));
    engine.statusChanged?.(status(false));
    engine.statusChanged?.(status(true));
    engine.statusChanged?.(status(false));
    expect(net.dropped).toHaveBeenCalledTimes(2);
  });
});
