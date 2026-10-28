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
    routerPush: vi.fn(),
  };
});
const router = vi.hoisted(() => ({ refresh: () => {}, push: (href: string) => hoisted.routerPush(href) }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/offline-queue", () => ({ processQueue: vi.fn() }));
vi.mock("@/lib/offline-upload", () => ({ processUploadQueue: vi.fn() }));
vi.mock("@/lib/powersync/device-frames", () => ({ dropDeviceFrame: hoisted.dropDeviceFrame }));
vi.mock("sonner", () => ({ toast: { info: hoisted.toastInfo } }));
const net = vi.hoisted(() => ({ up: true }));
vi.mock("@/lib/pwa/connection", () => ({
  isServerReachable: () => net.up,
  useServerReachable: () => net.up,
  whenServerReachable: () => () => {},
  watchConnection: () => () => {},
}));

vi.mock("@/components/layout/TopNavigationProgress", () => ({ emitNavigationContentShown: hoisted.contentShown }));
vi.mock("@/lib/pwa/offline-report", () => ({
  noteOffline: hoisted.noteOffline,
  sendOfflineReport: hoisted.sendOfflineReport,
  savedPagesNow: async () => ({ frames: ["80d44d44 /customers"], pages: [] }),
}));

import PwaRegistration from "@/components/pwa/PwaRegistration";
import { UPDATE_RETRY_MS } from "@/lib/pwa/app-version";
import { markPageNotOnDevice, pageNotOnDevice } from "@/lib/pwa/page-not-on-device";

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
// page opens anyway and says in its place that its data isn't on the device
// (OfflinePageGate) — Spotify's way (owner, 2026-10-28; staying put with a
// notice, since 10-24, frustrated more). With no connection a tap asks the
// service worker first whether the page opens from the device: Next.js never
// starts a move it can't finish (16.4 waited on it for good, then froze).

describe("a tap with no connection", () => {
  const pushState = vi.fn();
  const replaceState = vi.fn();
  const spies: { mockRestore: () => void }[] = [];
  /** The service worker's answer to "does it open from the device?" (undefined: none). */
  let answer: boolean | undefined;
  const asked: string[] = [];
  const showing = (path: string) => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        origin: "https://www.biz-h.com",
        href: `https://www.biz-h.com${path}`,
        pathname: path,
        search: "",
        reload,
      },
    });
  };
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    hoisted.toastInfo.mockClear();
    hoisted.contentShown.mockClear();
    hoisted.noteOffline.mockClear();
    hoisted.sendOfflineReport.mockClear();
    hoisted.routerPush.mockClear();
    pushState.mockReset();
    replaceState.mockReset();
    markPageNotOnDevice(null);
    answer = false;
    asked.length = 0;
    net.up = false;
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    showing("/dashboard");
    spies.push(
      vi.spyOn(window.history, "pushState").mockImplementation(pushState),
      vi.spyOn(window.history, "replaceState").mockImplementation(replaceState)
    );
    sw.controller = {
      postMessage: (message: { type: string; url: string }, ports: MessagePort[]) => {
        if (message.type !== "CAN_OPEN_OFFLINE") return;
        asked.push(message.url);
        if (answer !== undefined) ports[0].postMessage({ saved: answer });
      },
    };
    sw.register = vi.fn(async () => ({ update: async () => {} }));
    sw.ready = new Promise(() => {});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204, headers: { "X-Bizh-Build": "old1" } })));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    for (const spy of spies.splice(0)) spy.mockRestore();
    vi.useRealTimers();
    net.up = true;
  });

  /** A tap on a link inside the app; whether the app held it back (jsdom doesn't move either way). */
  const tap = (path: string, init: MouseEventInit = {}, attributes: Record<string, string> = {}) => {
    const link = document.createElement("a");
    link.href = `https://www.biz-h.com${path}`;
    for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
    document.body.appendChild(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    link.dispatchEvent(event);
    link.remove();
    return event.defaultPrevented;
  };
  /** The service worker's answer comes through a message port. */
  const answered = () => act(async () => new Promise<void>((resolve) => setImmediate(resolve)));
  const tell = (url: string) =>
    sw.dispatchEvent(new MessageEvent("message", { data: { type: "PAGE_NOT_SAVED", url } }));

  it("a page not on the device: opens it, marked as such — no notice on top, the loading bar ends", async () => {
    render(<PwaRegistration />);
    await settle();
    expect(tap("/calendar")).toBe(true);
    expect(asked).toEqual(["https://www.biz-h.com/calendar"]);
    await answered();
    expect(pageNotOnDevice()).toBe("/calendar");
    expect(pushState).toHaveBeenCalledWith(null, "", "/calendar");
    expect(hoisted.routerPush).not.toHaveBeenCalled();
    expect(hoisted.toastInfo).not.toHaveBeenCalled();
    expect(hoisted.contentShown).toHaveBeenCalledTimes(1);
    // A note for the report sent once the connection is back: which page, and what was saved.
    await settle();
    expect(hoisted.noteOffline).toHaveBeenCalledWith(
      "page not saved",
      // As text — Sentry cuts a list this deep to "[Array]".
      expect.objectContaining({ url: "/calendar", frames: "80d44d44 /customers" })
    );
  });

  it("a page the device has: the move goes on as usual", async () => {
    answer = true;
    render(<PwaRegistration />);
    await settle();
    expect(tap("/customers")).toBe(true);
    await answered();
    expect(hoisted.routerPush).toHaveBeenCalledWith("/customers");
    expect(pageNotOnDevice()).toBeNull();
    expect(pushState).not.toHaveBeenCalled();
  });

  it("no answer from the service worker: the move goes on as usual", async () => {
    answer = undefined;
    render(<PwaRegistration />);
    await settle();
    tap("/customers");
    vi.advanceTimersByTime(1500);
    await answered();
    expect(hoisted.routerPush).toHaveBeenCalledWith("/customers");
  });

  it("with a connection: nothing asked, nothing held", async () => {
    net.up = true;
    render(<PwaRegistration />);
    await settle();
    expect(tap("/calendar")).toBe(false);
    expect(asked).toEqual([]);
  });

  it("not a plain move — a task row that opens here, a tap with ctrl: left alone", async () => {
    render(<PwaRegistration />);
    await settle();
    expect(tap("/tasks?task=t1", {}, { "data-opens-here": "" })).toBe(false);
    expect(tap("/calendar", { ctrlKey: true })).toBe(false);
    expect(asked).toEqual([]);
  });

  it("on to another page: the one not on the device is left behind", async () => {
    render(<PwaRegistration />);
    await settle();
    tap("/calendar");
    await answered();
    showing("/calendar");
    answer = true;
    tap("/tasks");
    expect(pageNotOnDevice()).toBeNull();
  });

  it("a move answered 'not saved' anyway (the connection's loss not known yet): settled where it is", async () => {
    net.up = true;
    render(<PwaRegistration />);
    await settle();
    tell("https://www.biz-h.com/calendar");
    vi.advanceTimersByTime(300);
    // Next.js waits for a whole-page load that isn't coming — the same address in the history again settles it.
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://www.biz-h.com/dashboard");
    expect(pushState).not.toHaveBeenCalled();
    expect(pageNotOnDevice()).toBeNull();
    expect(hoisted.toastInfo).not.toHaveBeenCalled();
    await settle();
    expect(hoisted.noteOffline).toHaveBeenCalledWith("page not saved", expect.objectContaining({ url: "/calendar" }));
  });

  it("the page on screen itself (refreshed, or changing its own address): settled, nothing noted", async () => {
    render(<PwaRegistration />);
    await settle();
    tell("https://www.biz-h.com/dashboard");
    vi.advanceTimersByTime(300);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://www.biz-h.com/dashboard");
    await settle();
    expect(hoisted.noteOffline).not.toHaveBeenCalled();
  });

  it("what went wrong offline is sent when the app opens, and each time the server answers again", async () => {
    net.up = true;
    const { rerender } = render(<PwaRegistration />);
    await settle();
    expect(hoisted.sendOfflineReport).toHaveBeenCalledTimes(1);
    net.up = false;
    rerender(<PwaRegistration />);
    expect(hoisted.sendOfflineReport).toHaveBeenCalledTimes(1);
    net.up = true;
    rerender(<PwaRegistration />);
    expect(hoisted.sendOfflineReport).toHaveBeenCalledTimes(2);
  });

  it("a tab in the background does nothing (every open tab hears it)", async () => {
    visibility = "hidden";
    render(<PwaRegistration />);
    await settle();
    tell("https://www.biz-h.com/customers/c1");
    vi.advanceTimersByTime(300);
    expect(replaceState).not.toHaveBeenCalled();
  });
});

// A test build (NEXT_PUBLIC_E2E_TEST) keeps the worker off on 127.0.0.1, where
// sw.js would remove itself mid-test — except on the offline test's .test
// address, where the worker is what's tested (e2e/offline-pages.spec.ts).

describe("a test build", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_E2E_TEST", "1");
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    sw.controller = null;
    sw.register = vi.fn(async () => ({ update: async () => {} }));
    sw.ready = new Promise(() => {});
    Object.assign(sw, { getRegistrations: vi.fn(async () => []) });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204, headers: { "X-Bizh-Build": "old1" } })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const at = (hostname: string) =>
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, hostname, reload } });

  it("registers no worker on 127.0.0.1", async () => {
    at("127.0.0.1");
    render(<PwaRegistration />);
    await settle();
    expect(sw.register).not.toHaveBeenCalled();
  });

  it("registers it on the offline test's .test address", async () => {
    at("bizh.test");
    render(<PwaRegistration />);
    await settle();
    expect(sw.register).toHaveBeenCalledWith("/sw.js?v=old1");
  });
});
