import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

// public/sw.js run inside a stand-in service-worker global: navigation preload
// is switched on when the worker activates, and a page navigation uses the
// response the browser already started (event.preloadResponse) instead of
// fetching the page a second time — falling back to fetch() when there's no
// preload or it failed.

const SW_SOURCE = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");

function loadWorker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const enable = vi.fn(async () => {});
  const cache = { put: vi.fn(async () => {}), add: vi.fn(async () => {}) };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [] as string[]),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => undefined),
  };
  const fetchMock = vi.fn(async () => new Response("from fetch", { status: 200 }));
  const self = {
    location: new URL("https://biz-h.com/sw.js?v=test"),
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers[type] = handler;
    },
    registration: { navigationPreload: { enable } },
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) },
    skipWaiting: vi.fn(async () => {}),
  };
  vm.runInContext(
    SW_SOURCE,
    vm.createContext({ self, caches, fetch: fetchMock, Response, URL, setTimeout, clearTimeout, Promise })
  );
  return { handlers, enable, fetchMock };
}

async function navigate(worker: ReturnType<typeof loadWorker>, preloadResponse: Promise<Response | undefined> | undefined) {
  let responded: Promise<Response> | undefined;
  worker.handlers.fetch({
    request: {
      method: "GET",
      url: "https://biz-h.com/dashboard",
      mode: "navigate",
      headers: new Headers({ accept: "text/html" }),
    },
    preloadResponse,
    respondWith: (promise: Promise<Response>) => {
      responded = promise;
    },
  });
  if (!responded) throw new Error("the navigation wasn't answered");
  return responded;
}

describe("service worker navigation preload", () => {
  it("switches navigation preload on when the worker activates", async () => {
    const worker = loadWorker();
    let activated: Promise<unknown> | undefined;
    worker.handlers.activate({ waitUntil: (promise: Promise<unknown>) => (activated = promise) });
    await activated;
    expect(worker.enable).toHaveBeenCalledTimes(1);
  });

  it("answers a page navigation with the preloaded response, without fetching it again", async () => {
    const worker = loadWorker();
    const res = await navigate(worker, Promise.resolve(new Response("preloaded", { status: 200 })));
    expect(await res.text()).toBe("preloaded");
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the page itself when there's no preload (unsupported browser)", async () => {
    const worker = loadWorker();
    const res = await navigate(worker, Promise.resolve(undefined));
    expect(await res.text()).toBe("from fetch");
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to an ordinary fetch when the preload failed", async () => {
    const worker = loadWorker();
    const res = await navigate(worker, Promise.reject(new Error("preload aborted")));
    expect(await res.text()).toBe("from fetch");
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });
});
