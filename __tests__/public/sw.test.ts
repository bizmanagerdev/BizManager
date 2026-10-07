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

// The device pages' frames: a page drawn from the phone's copy arrives as a
// frame (it carries data-device-page). It's saved, and the next time the app
// opens on that page it's answered from the saved frame at once — refreshed
// in the background only when it's old. Pages with their data in them, the
// server version (?data=server) and searches are never saved.

function loadWorkerWithCaches(network: () => Response) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (request: { url: string } | string) => (typeof request === "string" ? request : request.url);
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (request: { url: string }, response: Response) => void store.set(keyOf(request), response),
        match: async (request: { url: string }) => store.get(keyOf(request))?.clone(),
        delete: async (request: { url: string }) => store.delete(keyOf(request)),
        add: async () => {},
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  const fetchMock = vi.fn(async () => network());
  const self = {
    location: new URL("https://biz-h.com/sw.js?v=test"),
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers[type] = handler;
    },
    registration: { navigationPreload: { enable: vi.fn(async () => {}) } },
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) },
    skipWaiting: vi.fn(async () => {}),
  };
  vm.runInContext(
    SW_SOURCE,
    vm.createContext({ self, caches, fetch: fetchMock, Response, URL, Date, setTimeout, clearTimeout, Promise })
  );
  const frames = () => stores.get("bizh-frames-test") ?? new Map<string, Response>();
  return { handlers, fetchMock, frames };
}

async function open(worker: { handlers: Record<string, (event: unknown) => void> }, url: string) {
  let responded: Promise<Response> | undefined;
  const background: Promise<unknown>[] = [];
  worker.handlers.fetch({
    request: { method: "GET", url, mode: "navigate", headers: new Headers({ accept: "text/html" }) },
    preloadResponse: Promise.resolve(undefined),
    respondWith: (promise: Promise<Response>) => {
      responded = promise;
    },
    waitUntil: (promise: Promise<unknown>) => void background.push(promise),
  });
  if (!responded) throw new Error("the navigation wasn't answered");
  const res = await responded;
  const text = await res.text();
  await Promise.all(background);
  return text;
}

const FRAME = '<html><body><span hidden data-device-page="tasks"></span></body></html>';

describe("service worker: the device pages' frames", () => {
  it("saves a device page's frame, then opens on it at once without waiting for the server", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200, headers: { "Content-Type": "text/html" } }));
    expect(await open(worker, "https://biz-h.com/tasks")).toBe(FRAME);
    expect(worker.frames().has("https://biz-h.com/tasks")).toBe(true);

    // Opened again later: the saved frame at once, a fresh copy saved behind it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 60_000));
    try {
      worker.fetchMock.mockClear();
      expect(await open(worker, "https://biz-h.com/tasks")).toBe(FRAME);
      expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a reload right after (a newer version on the server) never gets the same old frame again", async () => {
    let body = FRAME;
    let release: () => void = () => {};
    const worker = loadWorkerWithCaches(() => new Response(body, { status: 200 }));
    await open(worker, "https://biz-h.com/tasks"); // saved
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 60_000));
    try {
      // Opened: served the saved frame; its background refresh is held back.
      const pending = new Promise<void>((resolve) => (release = resolve));
      worker.fetchMock.mockImplementationOnce(async () => {
        await pending;
        return new Response(body, { status: 200 });
      });
      let responded: Promise<Response> | undefined;
      worker.handlers.fetch({
        request: { method: "GET", url: "https://biz-h.com/tasks", mode: "navigate", headers: new Headers() },
        preloadResponse: Promise.resolve(undefined),
        respondWith: (promise: Promise<Response>) => (responded = promise),
        waitUntil: () => {},
      });
      expect(await (await responded!).text()).toBe(FRAME);

      // Seconds later the page reloads for the newer version: the network, not the old frame.
      body = '<html><body><span hidden data-device-page="tasks"></span>new version</body></html>';
      vi.setSystemTime(new Date(Date.now() + 2_000));
      expect(await open(worker, "https://biz-h.com/tasks")).toContain("new version");
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it("never saves a page with its data in it — and drops a saved frame when the page comes back as one", async () => {
    let body = FRAME;
    const worker = loadWorkerWithCaches(() => new Response(body, { status: 200 }));
    await open(worker, "https://biz-h.com/tasks");
    expect(worker.frames().has("https://biz-h.com/tasks")).toBe(true);

    // The page was switched back to the server version: no marker.
    body = "<html><body>the server's board</body></html>";
    worker.frames().clear();
    expect(await open(worker, "https://biz-h.com/tasks")).toBe(body);
    expect(worker.frames().has("https://biz-h.com/tasks")).toBe(false);
  });

  it("a reload with no network: the saved frame, not an older offline copy", async () => {
    let online = true;
    const worker = loadWorkerWithCaches(() => {
      if (!online) throw new TypeError("Failed to fetch");
      return new Response(FRAME, { status: 200 });
    });
    await open(worker, "https://biz-h.com/tasks"); // saved, and served just now
    online = false;
    expect(await open(worker, "https://biz-h.com/tasks")).toBe(FRAME);
  });

  it("the bare address (where the Android app opens) goes straight to the saved dashboard — no trip to the server", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    const answer = async (url: string) => {
      let responded: Promise<Response> | undefined;
      worker.handlers.fetch({
        request: { method: "GET", url, mode: "navigate", headers: new Headers() },
        preloadResponse: Promise.resolve(undefined),
        respondWith: (promise: Promise<Response>) => (responded = promise),
        waitUntil: () => {},
      });
      return responded!;
    };

    // No dashboard saved yet (or signed out — frames go at logout): the server decides.
    expect((await answer("https://biz-h.com/")).status).toBe(200);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);

    await open(worker, "https://biz-h.com/dashboard"); // saved
    worker.fetchMock.mockClear();
    const res = await answer("https://biz-h.com/");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://biz-h.com/dashboard");
    expect(worker.fetchMock).not.toHaveBeenCalled();

    // Anything else at that address still goes to the server.
    expect((await answer("https://biz-h.com/?next=/sales")).status).toBe(200);
  });

  it("leaves other pages, the server version and searches alone", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, "https://biz-h.com/tasks?data=server");
    await open(worker, "https://biz-h.com/projects?q=דנה");
    await open(worker, "https://biz-h.com/customers");
    expect(worker.frames().size).toBe(0);
  });
});
