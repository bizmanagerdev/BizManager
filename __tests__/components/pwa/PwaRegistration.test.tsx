// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

// A new version of the app (a new service worker taking control) is loaded by
// a reload — never while the app is on screen (it landed people back on the
// page they were leaving), only while it's in the background: at once if it
// already is, else the next time it goes there; once per session.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/offline-queue", () => ({ processQueue: vi.fn() }));
vi.mock("@/lib/offline-upload", () => ({ processUploadQueue: vi.fn() }));

import PwaRegistration from "@/components/pwa/PwaRegistration";

const reload = vi.fn();
let visibility: DocumentVisibilityState = "visible";
const sw = new EventTarget() as EventTarget & { controller: unknown; register: unknown; ready: unknown };

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("loading a new version of the app", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    reload.mockReset();
    sessionStorage.clear();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    sw.controller = {}; // a version is already running
    sw.register = vi.fn(async () => ({ update: async () => {} }));
    sw.ready = new Promise(() => {});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("on screen: waits — and reloads the moment the app goes to the background, once", () => {
    render(<PwaRegistration />);
    sw.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();

    setVisibility("hidden");
    expect(reload).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    setVisibility("hidden");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("already in the background: at once", () => {
    visibility = "hidden";
    render(<PwaRegistration />);
    sw.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the very first version on this device: no reload at all", () => {
    sw.controller = null;
    render(<PwaRegistration />);
    sw.dispatchEvent(new Event("controllerchange"));
    setVisibility("hidden");
    expect(reload).not.toHaveBeenCalled();
  });
});
