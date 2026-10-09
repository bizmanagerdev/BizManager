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
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (request: { url: string }, response: Response) => void store.set(keyOf(request), response),
        match: async (request: { url: string }) => store.get(keyOf(request))?.clone(),
        delete: async (request: { url: string }) => store.delete(keyOf(request)),
        keys: async () => [...store.keys()],
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
    vm.createContext({ self, caches, fetch: fetchMock, Response, Headers, URL, Date, setTimeout, clearTimeout, Promise })
  );
  const frames = () => stores.get("bizh-frames-test") ?? new Map<string, Response>();
  return { handlers, fetchMock, frames, stores };
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
