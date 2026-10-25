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

function loadWorkerWithCaches(network: () => Response | Promise<Response>, saved: Record<string, Record<string, string>> = {}) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  for (const [name, pages] of Object.entries(saved)) {
    stores.set(name, new Map(Object.entries(pages).map(([url, html]) => [url, new Response(html, { status: 200 })])));
  }
  const keyOf = (request: { url: string } | string) => (typeof request === "string" ? request : request.url);
  const withoutSearch = (url: string) => url.split("?")[0];
  // As the browser's Cache: `ignoreSearch` matches the address whatever its query.
  const find = (store: Map<string, Response>, request: { url: string } | string, options?: { ignoreSearch?: boolean }) => {
    const key = keyOf(request);
    if (!options?.ignoreSearch) return store.has(key) ? key : undefined;
    return [...store.keys()].find((url) => withoutSearch(url) === withoutSearch(key));
  };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        // As the browser's Cache: saving a page again moves it to the end of keys().
        put: async (request: { url: string }, response: Response) => {
          store.delete(keyOf(request));
          store.set(keyOf(request), response);
        },
        match: async (request: { url: string }, options?: { ignoreSearch?: boolean }) => {
          const key = find(store, request, options);
          return key === undefined ? undefined : store.get(key)?.clone();
        },
        delete: async (request: { url: string }) => store.delete(keyOf(request)),
        keys: async () => [...store.keys()].map((url) => ({ url })),
        add: async () => {},
      };
    },
    has: async (name: string) => stores.has(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    // Every cache, as the browser's caches.match() looks.
    match: async (request: { url: string } | string) => {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(request));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const fetchMock = vi.fn(async (..._args: unknown[]) => network());
  // The app's open pages, as the worker sees them.
  const clients = {
    claim: vi.fn(async () => {}),
    matchAll: vi.fn(async (): Promise<unknown[]> => []),
    get: vi.fn(async (_id: string): Promise<unknown> => undefined),
  };
  const self = {
    location: new URL("https://biz-h.com/sw.js?v=test"),
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers[type] = handler;
    },
    registration: { navigationPreload: { enable: vi.fn(async () => {}) } },
    clients,
    skipWaiting: vi.fn(async () => {}),
  };
  vm.runInContext(
    SW_SOURCE,
    vm.createContext({ self, caches, fetch: fetchMock, Response, Headers, URL, Date, setTimeout, clearTimeout, Promise })
  );
  const frames = () => stores.get("bizh-frames-test") ?? new Map<string, Response>();
  return { handlers, fetchMock, frames, stores, clients };
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
    await open(worker, "https://biz-h.com/financial/bank");
    expect(worker.frames().size).toBe(0);
  });

  // The customers list reads its filters from the address on the device (like
  // the drivers' /deliveries), so the one frame serves every filter.
  it("saves the customers list's frame, and serves it for any filter", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, "https://biz-h.com/customers");
    expect(worker.frames().has("https://biz-h.com/customers")).toBe(true);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 60_000));
    try {
      expect(await open(worker, "https://biz-h.com/customers?with_debt=yes")).toBe(FRAME);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves the rent roll's frame (its device version, 2026-10-21)", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, "https://biz-h.com/rent");
    expect(worker.frames().has("https://biz-h.com/rent")).toBe(true);
    await open(worker, "https://biz-h.com/rent?data=server");
    expect(worker.frames().has("https://biz-h.com/rent?data=server")).toBe(false);
  });

  it("saves the properties list's frame (its device version, 2026-10-21)", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, "https://biz-h.com/properties");
    expect(worker.frames().has("https://biz-h.com/properties")).toBe(true);
    await open(worker, "https://biz-h.com/properties?data=server");
    expect(worker.frames().has("https://biz-h.com/properties?data=server")).toBe(false);
  });

  // A project's page and an order's page: one frame each, the last 40 opened.
  const projectUrl = (n: number) => `https://biz-h.com/projects/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const orderUrl = (n: number) => `https://biz-h.com/sales/orders/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("saves a frame per project and per order, and opens a project seen before at once", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, projectUrl(1));
    await open(worker, orderUrl(1));
    expect(worker.frames().has(projectUrl(1))).toBe(true);
    expect(worker.frames().has(orderUrl(1))).toBe(true);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 60_000));
    try {
      worker.fetchMock.mockClear();
      expect(await open(worker, projectUrl(1))).toBe(FRAME);
      // Answered from the frame; the one fetch is the fresh copy saved behind it.
      expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves a frame per property too (its device version, 2026-10-21)", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    const propertyUrl = "https://biz-h.com/properties/00000000-0000-4000-8000-000000000001";
    await open(worker, propertyUrl);
    expect(worker.frames().has(propertyUrl)).toBe(true);
  });

  it("keeps only the 40 projects and orders opened last, never touching the main pages' frames", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, "https://biz-h.com/tasks");
    for (let n = 1; n <= 30; n++) await open(worker, projectUrl(n));
    for (let n = 1; n <= 15; n++) await open(worker, orderUrl(n));
    // Project 1 opened again: it moves to the newest, so it stays.
    await open(worker, projectUrl(1));

    const saved = [...worker.frames().keys()];
    expect(saved.filter((url) => url !== "https://biz-h.com/tasks")).toHaveLength(40);
    expect(saved).toContain("https://biz-h.com/tasks");
    expect(saved).toContain(projectUrl(1));
    expect(saved).not.toContain(projectUrl(2));
    expect(saved).not.toContain(projectUrl(6));
    expect(saved).toContain(projectUrl(7));
    expect(saved).toContain(orderUrl(15));
  });

  it("leaves a project's other pages and a new order alone", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, `${projectUrl(1)}/export?mode=worker`);
    await open(worker, `${orderUrl(1)}/edit`);
    await open(worker, "https://biz-h.com/sales/orders/new");
    await open(worker, `${projectUrl(1)}?data=server`);
    expect(worker.frames().size).toBe(0);
  });
});

// When the network doesn't answer: a page with a saved copy gets it after 3
// seconds (not a blank 8), marked as a saved copy; the previous version's saved
// pages survive an update for exactly this; "is the server back?" always goes
// to the network; and the offline page tries again by itself.

describe("service worker: when the connection hangs or drops", () => {
  const PAGE = "<html><body>המשלוחים שלי</body></html>";

  it("a hanging connection: the page's saved copy after 3 seconds, marked as such", async () => {
    vi.useFakeTimers();
    try {
      const worker = loadWorkerWithCaches(() => new Promise<Response>(() => {}), {
        "bizh-pages-test": { "https://biz-h.com/deliveries": PAGE },
      });
      const opened = open(worker, "https://biz-h.com/deliveries");
      await vi.advanceTimersByTimeAsync(2900);
      let text: string | null = null;
      void opened.then((t) => (text = t));
      await vi.advanceTimersByTimeAsync(0);
      expect(text).toBeNull(); // still waiting for the server
      await vi.advanceTimersByTimeAsync(200);
      expect(text).toMatch(/^<html data-bizh-saved="\d+"><body>המשלוחים שלי/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a server that answers, only slowly: after the first saved copy, reloads wait for the real page", async () => {
    // The accounts page behind an office filter (2026-10-12): ~4 s to arrive.
    // The first opening shows the saved copy at 3 s; the page then arrives, so
    // the server is there — the saved copy's reload (and any opening in the next
    // ten minutes) waits for it instead of landing on the saved copy again.
    vi.useFakeTimers();
    try {
      const slow = () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(new Response("<html><body>עדכני</body></html>", { status: 200 })), 4000)
        );
      const worker = loadWorkerWithCaches(slow, { "bizh-pages-test": { "https://biz-h.com/financial/bank": PAGE } });

      let first: string | null = null;
      void open(worker, "https://biz-h.com/financial/bank").then((t) => (first = t));
      await vi.advanceTimersByTimeAsync(3100);
      expect(first).toMatch(/^<html data-bizh-saved="\d+">/);
      await vi.advanceTimersByTimeAsync(1000); // the real page arrives, late

      let reload: string | null = null;
      void open(worker, "https://biz-h.com/financial/bank").then((t) => (reload = t));
      await vi.advanceTimersByTimeAsync(3100);
      expect(reload).toBeNull(); // still waiting — no saved copy this time
      await vi.advanceTimersByTimeAsync(1000);
      expect(reload).toBe("<html><body>עדכני</body></html>");

      // Ten minutes on, a hang gets the saved copy at 3 s again.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      let later: string | null = null;
      void open(worker, "https://biz-h.com/financial/bank").then((t) => (later = t));
      await vi.advanceTimersByTimeAsync(3100);
      expect(later).toMatch(/^<html data-bizh-saved="\d+">/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no saved copy: waits the full 8 seconds, then the offline page — which tries again by itself", async () => {
    vi.useFakeTimers();
    try {
      const worker = loadWorkerWithCaches(() => new Promise<Response>(() => {}));
      let text: string | null = null;
      void open(worker, "https://biz-h.com/reports").then((t) => (text = t));
      await vi.advanceTimersByTimeAsync(3500);
      expect(text).toBeNull();
      await vi.advanceTimersByTimeAsync(5000);
      expect(text).toContain("אין חיבור לאינטרנט");
      expect(text).toContain('fetch("/api/ping"');
    } finally {
      vi.useRealTimers();
    }
  });

  it("after an update: the previous version's saved pages stay (offline only); older ones go", async () => {
    const worker = loadWorkerWithCaches(
      () => {
        throw new TypeError("Failed to fetch");
      },
      {
        "bizh-pages-v1": { "https://biz-h.com/deliveries": "<html><body>v1</body></html>" },
        "bizh-pages-v2": { "https://biz-h.com/deliveries": PAGE },
        "bizh-static-v2": {},
        "bizh-pages-test": {},
      }
    );
    let activated: Promise<unknown> | undefined;
    worker.handlers.activate({ waitUntil: (promise: Promise<unknown>) => (activated = promise) });
    await activated;
    expect([...worker.stores.keys()].sort()).toEqual(["bizh-pages-test", "bizh-pages-v2", "bizh-static-v2"]);
    // No network, nothing saved by this version yet: the previous version's copy.
    expect(await open(worker, "https://biz-h.com/deliveries")).toMatch(/^<html data-bizh-saved="\d+"><body>המשלוחים שלי/);
  });

  it("“is the server back?” is never answered from the device", () => {
    const worker = loadWorkerWithCaches(() => new Response(null, { status: 204 }));
    const respondWith = vi.fn();
    worker.handlers.fetch({
      request: { method: "GET", url: "https://biz-h.com/api/ping", mode: "cors", headers: new Headers() },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });
});

// After a deploy: code files are kept by their path (the ?dpl= deployment tag
// changes every deploy, the file doesn't); a newer build's page saved in the
// background has its code fetched ahead; a file still used outlives the next
// purge; and a new version starts with the saved pages that are already its
// build (owner, 2026-10-09: the first opening after a deploy took 6–11 s).

describe("service worker: code files and saved pages across deploys", () => {
  async function asset(worker: ReturnType<typeof loadWorkerWithCaches>, url: string) {
    let responded: Promise<Response> | undefined;
    worker.handlers.fetch({
      request: { method: "GET", url, mode: "no-cors", headers: new Headers() },
      respondWith: (promise: Promise<Response>) => (responded = promise),
    });
    return (await responded!).text();
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("keeps a code file by its path: the next deploy's address for the same file comes from the phone", async () => {
    const worker = loadWorkerWithCaches(() => new Response("chunk", { status: 200 }));
    await asset(worker, "https://biz-h.com/_next/static/chunks/a1.js?dpl=dpl_1");
    await settle();
    expect(worker.stores.get("bizh-static-test")?.has("https://biz-h.com/_next/static/chunks/a1.js")).toBe(true);
    worker.fetchMock.mockClear();
    expect(await asset(worker, "https://biz-h.com/_next/static/chunks/a1.js?dpl=dpl_2")).toBe("chunk");
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it("a file found in an earlier version's cache is kept in this version's too", async () => {
    const worker = loadWorkerWithCaches(() => new Response("network", { status: 200 }), {
      "bizh-static-v1": { "https://biz-h.com/_next/static/chunks/b2.js": "old chunk" },
    });
    expect(await asset(worker, "https://biz-h.com/_next/static/chunks/b2.js?dpl=dpl_5")).toBe("old chunk");
    await settle();
    expect(worker.stores.get("bizh-static-test")?.has("https://biz-h.com/_next/static/chunks/b2.js")).toBe(true);
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  const page = (build: string) =>
    `<html><head><meta name="bizh-build" content="${build}"/><script src="/_next/static/chunks/n1.js?dpl=dpl_9" async></script></head>` +
    `<body><span hidden data-device-page="tasks"></span><script>self.__next_f.push([1,"1:I[\\"/_next/static/chunks/n2.js?dpl=dpl_9\\",[]]"])</script></body></html>`;

  async function openTwice(build: string) {
    let body = page("test");
    const worker = loadWorkerWithCaches(() => new Response(body, { status: 200 }));
    await open(worker, "https://biz-h.com/tasks"); // saved (this build)
    body = page(build); // what the server sends now
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 60_000));
    try {
      worker.fetchMock.mockClear();
      await open(worker, "https://biz-h.com/tasks"); // the saved page at once; refreshed behind it
    } finally {
      vi.useRealTimers();
    }
    return worker;
  }

  it("a newer build's page saved in the background: its code is fetched now, for the next opening", async () => {
    const worker = await openTwice("newer");
    const fetched = (worker.fetchMock.mock.calls as unknown as Array<[string | { url: string }]>).map(([request]) =>
      typeof request === "string" ? request : request.url
    );
    expect(fetched).toContain("https://biz-h.com/_next/static/chunks/n1.js?dpl=dpl_9");
    expect(fetched).toContain("https://biz-h.com/_next/static/chunks/n2.js?dpl=dpl_9");
    const statics = worker.stores.get("bizh-static-test");
    expect(statics?.has("https://biz-h.com/_next/static/chunks/n1.js")).toBe(true);
    expect(statics?.has("https://biz-h.com/_next/static/chunks/n2.js")).toBe(true);
    expect(worker.frames().get("https://biz-h.com/tasks")?.headers.get("X-Bizh-Build")).toBe("newer");
  });

  it("the same build saved again: nothing fetched ahead", async () => {
    const worker = await openTwice("test");
    expect(worker.fetchMock).toHaveBeenCalledTimes(1); // just the page
  });

  it("a new version starts with the previous version's saved pages of its own build — never another build's", async () => {
    const worker = loadWorkerWithCaches(() => new Response("network", { status: 200 }), { "bizh-pages-v2": {} });
    const saved = (build: string) =>
      new Response(FRAME, { status: 200, headers: { "Content-Type": "text/html", "X-Bizh-Build": build } });
    worker.stores.set(
      "bizh-frames-v2",
      new Map([
        ["https://biz-h.com/dashboard", saved("test")],
        ["https://biz-h.com/tasks", saved("v2")],
      ])
    );
    let activated: Promise<unknown> | undefined;
    worker.handlers.activate({ waitUntil: (promise: Promise<unknown>) => (activated = promise) });
    await activated;
    expect([...worker.frames().keys()]).toEqual(["https://biz-h.com/dashboard"]);
  });
});

// A page reached by moving inside the app is never loaded whole, so the
// worker never saw it, and it didn't open with no connection (owner's offline
// test, 2026-10-24). The page asks for it to be saved (SAVE_FRAMES), and the
// app asks for the menu's pages after each update: each one not saved yet is
// fetched in the background, one after another, asking the server to leave
// out its once-a-day comparison.

describe("service worker: saving the pages the app asks for", () => {
  const customerUrl = "https://biz-h.com/customers/00000000-0000-4000-8000-000000000001";

  async function ask(worker: ReturnType<typeof loadWorkerWithCaches>, urls: unknown[]) {
    const background: Promise<unknown>[] = [];
    worker.handlers.message({
      data: { type: "SAVE_FRAMES", urls },
      waitUntil: (promise: Promise<unknown>) => void background.push(promise),
    });
    await Promise.all(background);
  }

  it("saves a page moved to inside the app, fetched with the server's comparison left out", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await ask(worker, [customerUrl]);
    expect(worker.frames().has(customerUrl)).toBe(true);
    const [href, init] = worker.fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; credentials: string }];
    expect(href).toBe(customerUrl);
    expect(init.headers["X-Bizh-Frame-Save"]).toBe("1");
    expect(init.credentials).toBe("same-origin");
  });

  it("a page already saved isn't fetched again", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, customerUrl);
    worker.fetchMock.mockClear();
    await ask(worker, [customerUrl]);
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it("the customers list with a filter: saved once, as the list (its one frame serves every filter)", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await ask(worker, ["https://biz-h.com/customers?withDebt=yes"]);
    expect([...worker.frames().keys()]).toEqual(["https://biz-h.com/customers"]);
    worker.fetchMock.mockClear();
    await ask(worker, ["https://biz-h.com/customers?withOrders=yes"]);
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it("leaves alone pages without a device version, the server version, searches and other sites", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await ask(worker, [
      "https://biz-h.com/financial/bank",
      "https://biz-h.com/tasks?data=server",
      "https://biz-h.com/projects?q=דנה",
      "https://example.com/tasks",
      42,
    ]);
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it("its code is saved with it — a page never opened here couldn't start with no connection", async () => {
    const page =
      '<html><head><meta name="bizh-build" content="test"/><script src="/_next/static/chunks/tasks-page.js?dpl=d1" async></script></head>' +
      '<body><span hidden data-device-page="tasks"></span></body></html>';
    const worker = loadWorkerWithCaches(() => new Response(page, { status: 200 }));
    await ask(worker, ["https://biz-h.com/tasks"]);
    expect(worker.frames().has("https://biz-h.com/tasks")).toBe(true);
    expect(worker.stores.get("bizh-static-test")?.has("https://biz-h.com/_next/static/chunks/tasks-page.js")).toBe(true);
  });

  it("a page that comes back as its server version (the device's copy not ready) isn't saved", async () => {
    const worker = loadWorkerWithCaches(() => new Response("<html><body>the server's list</body></html>", { status: 200 }));
    await ask(worker, ["https://biz-h.com/customers"]);
    expect(worker.frames().size).toBe(0);
  });

  it("the menu's pages: one after another, with a pause between — never all at once", async () => {
    vi.useFakeTimers();
    try {
      const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
      let done = false;
      void ask(worker, ["/dashboard", "/tasks", "/projects"]).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(worker.fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1500);
      expect(worker.fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1500);
      expect(worker.fetchMock).toHaveBeenCalledTimes(3);
      expect(done).toBe(true);
      expect([...worker.frames().keys()]).toEqual([
        "https://biz-h.com/dashboard",
        "https://biz-h.com/tasks",
        "https://biz-h.com/projects",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a list page saved with its own address counts with the records' 40 — the menu's pages stay", async () => {
    const worker = loadWorkerWithCaches(() => new Response(FRAME, { status: 200 }));
    await open(worker, "https://biz-h.com/sales");
    for (let n = 1; n <= 45; n++) await open(worker, `https://biz-h.com/sales?customerId=c${n}`);
    const saved = [...worker.frames().keys()];
    expect(saved).toContain("https://biz-h.com/sales");
    expect(saved.filter((url) => url.includes("?"))).toHaveLength(40);
    expect(saved).not.toContain("https://biz-h.com/sales?customerId=c5");
    expect(saved).toContain("https://biz-h.com/sales?customerId=c45");
  });
});

// Moving inside the app, with no connection, to a page with no saved copy:
// the page on screen stays (a 204 leaves it as it is) and the open pages are
// told which page it was — instead of landing on another page or the offline
// page (owner, 2026-10-24: "the whole app basically crashed"). Next.js asks
// for the page's data first, then loads it whole; a second try at the same
// page stops at the first step, so that one tells the pages too.

describe("service worker: a page with no saved copy, with no connection", () => {
  const customerUrl = "https://biz-h.com/customers/00000000-0000-4000-8000-000000000002";
  const offline = () => {
    throw new TypeError("Failed to fetch");
  };

  async function answer(
    worker: ReturnType<typeof loadWorkerWithCaches>,
    request: { url: string; mode: string; headers?: Headers; referrer?: string }
  ) {
    let responded: Promise<Response> | undefined;
    const background: Promise<unknown>[] = [];
    worker.handlers.fetch({
      request: { method: "GET", headers: new Headers(), ...request },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (promise: Promise<Response>) => (responded = promise),
      waitUntil: (promise: Promise<unknown>) => void background.push(promise),
    });
    const res = await responded!;
    await Promise.all(background);
    return res;
  }

  /** The app's open tabs: the customers list in front, the sales page behind it. */
  function withPage(worker: ReturnType<typeof loadWorkerWithCaches>) {
    const page = { id: "tab-1", url: "https://biz-h.com/customers", focused: true, postMessage: vi.fn() };
    const other = { id: "tab-2", url: "https://biz-h.com/sales", focused: false, postMessage: vi.fn() };
    worker.clients.matchAll.mockResolvedValue([other, page]);
    worker.clients.get.mockImplementation(async (id: string) => [page, other].find((tab) => tab.id === id));
    return Object.assign(page, { other });
  }

  it("moved to inside the app: stays where it is, and that tab — only that one — hears which page wasn't saved", async () => {
    const worker = loadWorkerWithCaches(offline, { "bizh-static-test": { "/dashboard": "<html>board</html>" } });
    const page = withPage(worker);
    const res = await answer(worker, { url: customerUrl, mode: "navigate", referrer: "https://biz-h.com/customers" });
    expect(res.status).toBe(204);
    expect(page.postMessage).toHaveBeenCalledWith({ type: "PAGE_NOT_SAVED", url: customerUrl });
    // A tab behind it isn't told (it said so on the page in front, 2026-10-25).
    expect(page.other.postMessage).not.toHaveBeenCalled();
  });

  it("typed in, or the app opening (no page it came from): somewhere to land, as before", async () => {
    const worker = loadWorkerWithCaches(offline, { "bizh-static-test": { "/dashboard": "<html>board</html>" } });
    const page = withPage(worker);
    const res = await answer(worker, { url: customerUrl, mode: "navigate", referrer: "" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("board");
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  it("a page with a saved frame opens from it — the list's frame for any filter", async () => {
    const worker = loadWorkerWithCaches(offline, { "bizh-frames-test": { "https://biz-h.com/customers": FRAME } });
    const page = withPage(worker);
    const res = await answer(worker, {
      url: "https://biz-h.com/customers?withDebt=yes",
      mode: "navigate",
      referrer: "https://biz-h.com/dashboard",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('data-device-page="tasks"');
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  it("the page's data asked for first (a second try never gets further): the tab that asked hears it at once", async () => {
    const worker = loadWorkerWithCaches(offline);
    const page = withPage(worker);
    let responded: Promise<Response> | undefined;
    const background: Promise<unknown>[] = [];
    worker.handlers.fetch({
      request: { method: "GET", url: `${customerUrl}?_rsc=abc12`, mode: "cors", headers: new Headers({ RSC: "1" }) },
      clientId: "tab-2",
      respondWith: (promise: Promise<Response>) => (responded = promise),
      waitUntil: (promise: Promise<unknown>) => void background.push(promise),
    });
    expect((await responded!).status).toBe(503);
    await Promise.all(background);
    expect(page.other.postMessage).toHaveBeenCalledWith({ type: "PAGE_NOT_SAVED", url: customerUrl });
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  it("…but not for a page that is saved (it loads whole from the frame next), nor for a prefetch", async () => {
    const worker = loadWorkerWithCaches(offline, { "bizh-frames-test": { [customerUrl]: FRAME } });
    const page = withPage(worker);
    await answer(worker, { url: `${customerUrl}?_rsc=abc12`, mode: "cors", headers: new Headers({ RSC: "1" }) });
    const other = "https://biz-h.com/customers/00000000-0000-4000-8000-000000000003";
    await answer(worker, {
      url: `${other}?_rsc=abc12`,
      mode: "cors",
      headers: new Headers({ RSC: "1", "Next-Router-Prefetch": "1" }),
    });
    expect(page.postMessage).not.toHaveBeenCalled();
  });
});
