// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The device pages' frames, from the page's side (lib/powersync/device-frames.ts):
// which menu pages are saved for this person after each update, asking the
// service worker to save pages, and dropping one page's frame before a reload
// onto a newer version — the others stay, for opening with no connection
// (owner's offline test, 2026-10-24).

const h = vi.hoisted(() => ({ headers: new Map<string, string>(), cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => h.headers.get(name) ?? null }),
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined), has: () => false }),
}));
vi.mock("@/lib/timezone", () => ({ israelDateKey: () => "2026-10-24" }));
const net = vi.hoisted(() => ({ up: true }));
vi.mock("@/lib/pwa/connection", () => ({
  isServerReachable: () => net.up,
  useServerReachable: () => net.up,
  whenServerReachable: () => () => {},
  watchConnection: () => () => {},
}));


import { dropDeviceFrame, menuFramePaths, saveAppCode, saveDeviceFrames } from "@/lib/powersync/device-frames";
import { RUNNING_BUILD } from "@/lib/pwa/app-version";
import { deviceCheckDue } from "@/lib/powersync/device-check";
import { DEFAULT_SECTION_ACCESS } from "@/lib/auth/sections";

describe("the menu pages saved for offline after each update", () => {
  it("admin and office: every list page drawn from the device — not the drivers' page", () => {
    const paths = ["/dashboard", "/tasks", "/projects", "/sales", "/customers", "/properties", "/rent"];
    expect(menuFramePaths({ id: "a1", role: "admin" })).toEqual(paths);
    expect(menuFramePaths({ id: "o1", role: "office" })).toEqual(paths);
  });

  it("a worker: his own sections that have a device version", () => {
    const worker = { id: "w1", role: "worker", locale: "he" };
    expect(menuFramePaths(worker, DEFAULT_SECTION_ACCESS)).toEqual(["/dashboard", "/tasks", "/deliveries"]);
    expect(menuFramePaths(worker, { ...DEFAULT_SECTION_ACCESS, tasks: false, deliveries: false })).toEqual(["/dashboard"]);
  });

  it("a worker reading Arabic: none (his pages come from the server)", () => {
    expect(menuFramePaths({ id: "w2", role: "worker", locale: "ar" }, DEFAULT_SECTION_ACCESS)).toEqual([]);
  });
});

describe("asking the service worker to save pages", () => {
  const postMessage = vi.fn();
  beforeEach(() => {
    postMessage.mockReset();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: { postMessage } } });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    vi.restoreAllMocks();
  });

  it("asks the worker running the page", () => {
    saveDeviceFrames(["/customers/c1"]);
    expect(postMessage).toHaveBeenCalledWith({ type: "SAVE_FRAMES", urls: ["/customers/c1"] });
  });

  it("not with no connection, nor with nothing to ask for", () => {
    saveDeviceFrames([]);
    net.up = false;
    saveDeviceFrames(["/customers/c1"]);
    net.up = true;
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("asks for the whole app's code — this version's, from the deployment this page came from", () => {
    const script = document.createElement("script");
    script.src = "https://www.biz-h.com/_next/static/chunks/main.js?dpl=dpl_5";
    document.head.appendChild(script);
    try {
      saveAppCode();
      expect(postMessage).toHaveBeenCalledWith({ type: "SAVE_APP_CODE", build: RUNNING_BUILD, dpl: "dpl_5" });
    } finally {
      script.remove();
    }
  });

  it("the server not answering: the code isn't asked for (it couldn't be fetched)", () => {
    net.up = false;
    saveAppCode();
    expect(postMessage).not.toHaveBeenCalled();
    net.up = true;
  });

  it("no service worker (first visit, or not supported): nothing happens", () => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    expect(() => saveDeviceFrames(["/customers/c1"])).not.toThrow();
  });
});

describe("before a reload onto a newer version", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops that page's frames (any of its filters) in every frames cache — and nothing else", async () => {
    const deleted: [string, string, unknown][] = [];
    const open = vi.fn(async (name: string) => ({
      delete: async (href: string, options: unknown) => {
        deleted.push([name, href, options]);
        return true;
      },
    }));
    vi.stubGlobal("caches", {
      keys: async () => ["bizh-frames-b2", "bizh-pages-b2", "bizh-frames-b1", "bizh-static-b2"],
      open,
    });
    await dropDeviceFrame("https://www.biz-h.com/sales?tab=quotes");
    expect(deleted).toEqual([
      ["bizh-frames-b2", "https://www.biz-h.com/sales?tab=quotes", { ignoreSearch: true }],
      ["bizh-frames-b1", "https://www.biz-h.com/sales?tab=quotes", { ignoreSearch: true }],
    ]);
  });

  it("no Cache Storage here: nothing to drop, no error", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(dropDeviceFrame("https://www.biz-h.com/tasks")).resolves.toBeUndefined();
  });
});

describe("the once-a-day comparison, for a frame saved in the background", () => {
  beforeEach(() => {
    h.headers.clear();
    h.cookie = undefined;
  });

  it("due when this device hasn't compared the page today", async () => {
    expect(await deviceCheckDue("customers")).toBe(true);
    h.cookie = "2026-10-24";
    expect(await deviceCheckDue("customers")).toBe(false);
  });

  it("left out when the service worker saves the frame (nobody is looking at it)", async () => {
    h.headers.set("x-bizh-frame-save", "1");
    expect(await deviceCheckDue("customers")).toBe(false);
  });
});
