// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// A new version of the app is loaded by a reload — never while the app is on
// screen (it landed people back on the page they were leaving), only while it's
// in the background: at once if it already is, else the next time it goes
// there. Two things say there's one: a new service worker taking control, and
// the server reporting a newer build when the app opens or comes back to the
// screen (owner, 2026-10-20: a phone kept alive by Android stayed on an old
// version for days). Before the reload this page's saved copy goes, so it
// lands on the new version — the other pages' copies stay, for opening with no
// connection. Once per build — and again after a while, not once per session.

const hoisted = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BUILD_ID = "old1";
  return {
    dropDeviceFrame: vi.fn(async (_href: string) => {}),
    toastInfo: vi.fn(),
    contentShown: vi.fn(),
    noteOffline: vi.fn(),
    sendOfflineReport: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/offline-queue", () => ({ processQueue: vi.fn() }));
vi.mock("@/lib/offline-upload", () => ({ processUploadQueue: vi.fn() }));
vi.mock("@/lib/powersync/device-frames", () => ({ dropDeviceFrame: hoisted.dropDeviceFrame }));
vi.mock("sonner", () => ({ toast: { info: hoisted.toastInfo } }));
vi.mock("@/components/layout/TopNavigationProgress", () => ({ emitNavigationContentShown: hoisted.contentShown }));
vi.mock("@/lib/pwa/offline-report", () => ({
  noteOffline: hoisted.noteOffline,
  sendOfflineReport: hoisted.sendOfflineReport,
  savedPagesNow: async () => ({ frames: ["80d44d44 /customers"], pages: [] }),
}));

import PwaRegistration from "@/components/pwa/PwaRegistration";
import { UPDATE_RETRY_MS } from "@/lib/pwa/app-version";

const reload = vi.fn();
let visibility: DocumentVisibilityState = "visible";
const sw = new EventTarget() as EventTarget & { controller: unknown; register: unknown; ready: unknown };
let liveBuild = "old1";

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe("loading a new version of the app", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    reload.mockReset();
    hoisted.dropDeviceFrame.mockClear();
    hoisted.toastInfo.mockClear();
    sessionStorage.clear();
    visibility = "visible";
    liveBuild = "old1";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    sw.controller = {}; // a version is already running
    sw.register = vi.fn(async () => ({ update: async () => {} }));
    sw.ready = new Promise(() => {});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204, headers: { "X-Bizh-Build": liveBuild } }))
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("on screen: waits — and reloads the moment the app goes to the background, once", async () => {
    render(<PwaRegistration />);
    await settle();
    sw.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();

    setVisibility("hidden");
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(hoisted.dropDeviceFrame).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    setVisibility("hidden");
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("already in the background: at once", async () => {
    visibility = "hidden";
    render(<PwaRegistration />);
    sw.dispatchEvent(new Event("controllerchange"));
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the very first version on this device: no reload at all", async () => {
    sw.controller = null;
    render(<PwaRegistration />);
    sw.dispatchEvent(new Event("controllerchange"));
    setVisibility("hidden");
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });

  it("a worker of this page's own build taking over: nothing newer, no reload", async () => {
    render(<PwaRegistration />);
    await settle();
    sw.controller = { scriptURL: "https://www.biz-h.com/sw.js?v=old1" };
    sw.dispatchEvent(new Event("controllerchange"));
    setVisibility("hidden");
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });

  it("the server runs a newer build: reloads onto it when the app is left, without this page's saved copy", async () => {
    liveBuild = "new2";
    render(<PwaRegistration />);
    await settle();
    expect(reload).not.toHaveBeenCalled();

    setVisibility("hidden");
    await settle();
    // Only the page being reloaded — the rest stay for opening with no connection.
    expect(hoisted.dropDeviceFrame).toHaveBeenCalledTimes(1);
    expect(hoisted.dropDeviceFrame).toHaveBeenCalledWith(window.location.href);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the server runs this same build: stays", async () => {
    render(<PwaRegistration />);
    await settle();
    setVisibility("hidden");
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });

  it("an app left open for days: still moves on at the next deploy (not once per session)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T19:00:00Z"));
    liveBuild = "new2";
    render(<PwaRegistration />);
    await settle();
    setVisibility("hidden");
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);

    // The reload didn't take (still this build) — not again at once…
    setVisibility("visible");
    setVisibility("hidden");
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);

    // …but the next time the app comes back after a while, it tries again.
    vi.setSystemTime(new Date(Date.now() + UPDATE_RETRY_MS + 6 * 60 * 1000));
    setVisibility("visible");
    await settle();
    setVisibility("hidden");
    await settle();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

// Moving inside the app to a page with no saved copy, with no connection: the
// service worker keeps this page on screen and says which page it was. The
// page says so, and settles Next.js's router (which gave up on the move and
// waits for a whole-page load that isn't coming) by putting the same address
// in the history again (owner, 2026-10-24).

describe("a page moved to with no connection that isn't saved", () => {
  const replaceState = vi.fn();
  let historySpy: { mockRestore: () => void } | undefined;
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    hoisted.toastInfo.mockClear();
    hoisted.contentShown.mockClear();
    hoisted.noteOffline.mockClear();
    hoisted.sendOfflineReport.mockClear();
    replaceState.mockReset();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, href: "https://www.biz-h.com/customers", pathname: "/customers", search: "", reload },
    });
    historySpy = vi.spyOn(window.history, "replaceState").mockImplementation(replaceState);
    sw.controller = {};
    sw.register = vi.fn(async () => ({ update: async () => {} }));
    sw.ready = new Promise(() => {});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204, headers: { "X-Bizh-Build": "old1" } })));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    historySpy?.mockRestore();
    vi.useRealTimers();
  });

  const tell = (url: string) =>
    sw.dispatchEvent(new MessageEvent("message", { data: { type: "PAGE_NOT_SAVED", url } }));

  it("says so, and settles the router on the page on screen", async () => {
    render(<PwaRegistration />);
    await settle();
    tell("https://www.biz-h.com/customers/c1");
    expect(hoisted.toastInfo).toHaveBeenCalledWith("הדף הזה לא שמור במכשיר — ייפתח כשיחזור החיבור", {
      id: "page-not-saved",
    });
    // The loading bar that was waiting for the move ends now.
    expect(hoisted.contentShown).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://www.biz-h.com/customers");
    // A note for the report sent once the connection is back: which page, and what was saved.
    await settle();
    expect(hoisted.noteOffline).toHaveBeenCalledWith(
      "page not saved",
      expect.objectContaining({ url: "/customers/c1", frames: ["80d44d44 /customers"] })
    );
  });

  it("what went wrong offline is sent when the app opens, and when the connection comes back", async () => {
    render(<PwaRegistration />);
    await settle();
    expect(hoisted.sendOfflineReport).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("online"));
    expect(hoisted.sendOfflineReport).toHaveBeenCalledTimes(2);
  });

  it("the page on screen itself (refreshed with no connection): nothing to say", async () => {
    render(<PwaRegistration />);
    await settle();
    tell("https://www.biz-h.com/customers");
    vi.advanceTimersByTime(300);
    expect(hoisted.toastInfo).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("a tab in the background says nothing (every open tab hears it)", async () => {
    visibility = "hidden";
    render(<PwaRegistration />);
    await settle();
    tell("https://www.biz-h.com/customers/c1");
    vi.advanceTimersByTime(300);
    expect(hoisted.toastInfo).not.toHaveBeenCalled();
  });
});
