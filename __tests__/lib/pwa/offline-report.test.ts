// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What went wrong with no connection is kept on the device and sent to Sentry
// once it's back: a report sent offline is lost, and those are exactly the
// moments the offline work needs to see (owner's offline test, 2026-10-25).

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: (report: (s: typeof sentry) => void) => report(sentry) }));
const net = vi.hoisted(() => {
  const waiting = new Set<() => void>();
  return {
    up: true,
    waiting,
    /** The server answering again runs what waited for it (lib/pwa/connection.ts). */
    set(up: boolean) {
      this.up = up;
      if (up) for (const callback of [...waiting]) (waiting.delete(callback), callback());
    },
  };
});
vi.mock("@/lib/pwa/connection", () => ({
  isServerReachable: () => net.up,
  useServerReachable: () => net.up,
  whenServerReachable: (callback: () => void) => {
    if (net.up) {
      callback();
      return () => {};
    }
    net.waiting.add(callback);
    return () => net.waiting.delete(callback);
  },
  watchConnection: () => () => {},
}));


import { noteOffline, savedPagesNow, sendOfflineReport } from "@/lib/pwa/offline-report";

/** Whether the server answers (lib/pwa/connection.ts). */
function setOnline(online: boolean) {
  net.set(online);
}

beforeEach(() => {
  localStorage.clear();
  sentry.captureMessage.mockReset();
  setOnline(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("the offline report", () => {
  it("keeps notes offline, sends them as one report once there's a connection, then forgets them", () => {
    noteOffline("page not saved", { url: "/customers/c1" });
    noteOffline("page error", { message: "ChunkLoadError" });
    sendOfflineReport();
    expect(sentry.captureMessage).not.toHaveBeenCalled();

    setOnline(true);
    sendOfflineReport();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [title, options] = sentry.captureMessage.mock.calls[0] as [string, { extra: { notes: { what: string; url?: string }[] } }];
    expect(title).toBe("Offline report: page not saved, page error");
    expect(options.extra.notes.map((note) => note.what)).toEqual(["page not saved", "page error"]);
    expect(options.extra.notes[0].url).toBe("/customers/c1");

    sendOfflineReport();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the last 20 notes only", () => {
    for (let n = 1; n <= 25; n++) noteOffline("page not saved", { n });
    setOnline(true);
    sendOfflineReport();
    const notes = (sentry.captureMessage.mock.calls[0][1] as { extra: { notes: { n: number }[] } }).extra.notes;
    expect(notes).toHaveLength(20);
    expect(notes[0].n).toBe(6);
  });

  it("a saved copy on screen: the server isn't answering, whatever the device says — sent from the next page", () => {
    noteOffline("page error", { message: "x", savedCopy: true });
    setOnline(true);
    document.documentElement.dataset.bizhSaved = String(Date.now());
    try {
      sendOfflineReport();
      expect(sentry.captureMessage).not.toHaveBeenCalled();
    } finally {
      delete document.documentElement.dataset.bizhSaved;
    }
    sendOfflineReport();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("nothing kept: nothing sent", () => {
    setOnline(true);
    sendOfflineReport();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("lists the pages saved on the device, by the version that saved them — not their data requests", async () => {
    const stores: Record<string, string[]> = {
      "bizh-frames-80d44d44abc": ["https://www.biz-h.com/customers", "https://www.biz-h.com/tasks"],
      "bizh-pages-80d44d44abc": ["https://www.biz-h.com/inbox", "https://www.biz-h.com/customers/c1?_rsc=x1"],
      "bizh-static-80d44d44abc": ["https://www.biz-h.com/_next/static/a.js"],
    };
    vi.stubGlobal("caches", {
      keys: async () => Object.keys(stores),
      open: async (name: string) => ({ keys: async () => stores[name].map((url) => ({ url })) }),
    });
    expect(await savedPagesNow()).toEqual({
      frames: ["80d44d44 /customers", "80d44d44 /tasks"],
      pages: ["80d44d44 /inbox"],
    });
  });
});
