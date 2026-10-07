// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// A save that must not be lost (a delivery confirmation with its photos, a
// create with an idempotency key) is kept on the device BEFORE it's sent: if
// the app is closed, reloaded or loses its screen mid-send, it's still there
// and goes out on the next start — with the same key, so the server never
// makes it twice. While it's on its way it doesn't count as "waiting to sync",
// and it's taken off as soon as the server answers.

/** Just enough IndexedDB for lib/offline-upload.ts, shared across module reloads like the real one. */
function fakeIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    open() {
      const req: Record<string, unknown> & { onupgradeneeded?: () => void; onsuccess?: () => void } = {};
      const db = {
        objectStoreNames: { contains: (name: string) => stores.has(name) },
        createObjectStore: (name: string) => stores.set(name, new Map()),
        transaction: (name: string) => {
          const store = stores.get(name)!;
          const tx: { oncomplete?: () => void; onerror?: () => void; objectStore: () => unknown } = {
            objectStore: () => ({
              put: (value: { id: string }) => (store.set(value.id, value), { result: value.id }),
              getAll: () => ({ result: [...store.values()] }),
              delete: (id: string) => (store.delete(id), { result: undefined }),
              clear: () => (store.clear(), { result: undefined }),
            }),
          };
          setTimeout(() => tx.oncomplete?.(), 0);
          return tx;
        },
        close() {},
      };
      setTimeout(() => {
        req.result = db;
        if (stores.size === 0) req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
}

type Pending = { resolve: (r: Response) => void; reject: (e: unknown) => void; init: RequestInit };
let calls: Pending[] = [];

beforeEach(() => {
  vi.resetModules();
  calls = [];
  localStorage.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDB());
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => calls.push({ resolve, reject, init })))
  );
});
afterEach(() => vi.unstubAllGlobals());

/** Until the n-th request has gone out (however busy the machine is). */
const untilSent = (n: number) => vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(n), { timeout: 10_000, interval: 10 });
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const keyOf = (p: Pending) => (p.init.headers as Record<string, string>)["Idempotency-Key"];

describe("a photo upload / delivery confirmation (offlineUpload)", () => {
  const send = async () => {
    const { offlineUpload } = await import("@/lib/offline-upload");
    const file = new File(["jpg"], "delivery.jpg", { type: "image/jpeg" });
    return offlineUpload("/api/orders/update", { fields: { payload: "{}" }, files: [{ fieldName: "delivery_images", file }], label: "אישור האספקה" });
  };

  it("kept while it's on its way (not counted as waiting, not sent twice), gone once the server answers", async () => {
    const result = send();
    await untilSent(1);
    const queue = await import("@/lib/offline-upload");
    expect(await queue.getUploadQueueLength()).toBe(0);
    await queue.processUploadQueue();
    expect(calls).toHaveLength(1); // the replay left it alone

    calls[0].resolve(ok());
    expect(await result).toMatchObject({ queued: false, ok: true });
    expect(await queue.getUploadQueueLength()).toBe(0);
    vi.resetModules(); // even after a restart: nothing left behind
    expect(await (await import("@/lib/offline-upload")).getUploadQueueLength()).toBe(0);
  });

  it("the app closed mid-send: on the next start it's waiting, and goes out with the same key", async () => {
    void send();
    await untilSent(1);
    const firstKey = keyOf(calls[0]);

    vi.resetModules(); // the app starts again; the first send never answered
    const queue = await import("@/lib/offline-upload");
    expect(await queue.getUploadQueueLength()).toBe(1);
    const replay = queue.processUploadQueue();
    await untilSent(2);
    expect(calls).toHaveLength(2);
    expect(keyOf(calls[1])).toBe(firstKey);
    calls[1].resolve(ok());
    expect(await replay).toMatchObject({ processed: 1, remaining: 0 });
  });

  it("no answer (the network dropped): waiting; refused by the server: not kept", async () => {
    const dropped = send();
    await untilSent(1);
    calls[0].reject(new TypeError("Failed to fetch"));
    expect(await dropped).toEqual({ queued: true, reason: "slow" });
    const queue = await import("@/lib/offline-upload");
    expect(await queue.getUploadQueueLength()).toBe(1);

    await queue.clearFailedUploads();
    const refused = send();
    await untilSent(2);
    calls[1].resolve(new Response(JSON.stringify({ error: "אין הרשאה" }), { status: 403 }));
    expect(await refused).toMatchObject({ queued: false, ok: false, status: 403 });
    expect(await queue.getUploadQueueLength()).toBe(1); // only the dropped one
  });
});

describe("a create with an idempotency key (offlineFetch)", () => {
  it("kept while on its way, gone once answered; after a restart mid-send it's waiting with the same key", async () => {
    const { offlineFetch, getQueueLength } = await import("@/lib/offline-queue");
    const done = offlineFetch("/api/tasks/create", { subject: "x" }, "משימה", { idempotent: true });
    await untilSent(1);
    expect(getQueueLength()).toBe(0);
    calls[0].resolve(ok());
    expect(await done).toMatchObject({ ok: true });
    expect(JSON.parse(localStorage.getItem("biz_offline_queue") ?? "[]")).toEqual([]);

    void offlineFetch("/api/tasks/create", { subject: "y" }, "משימה", { idempotent: true });
    await untilSent(2);
    const firstKey = (calls[1].init.headers as Record<string, string>)["Idempotency-Key"];
    vi.resetModules();
    const restarted = await import("@/lib/offline-queue");
    expect(restarted.getQueueLength()).toBe(1);
    const replay = restarted.processQueue();
    await untilSent(3);
    expect((calls[2].init.headers as Record<string, string>)["Idempotency-Key"]).toBe(firstKey);
    calls[2].resolve(ok());
    expect(await replay).toMatchObject({ processed: 1, remaining: 0 });
  });

  it("without a key (can't be made safe to resend): sent as before, not kept first", async () => {
    const { offlineFetch } = await import("@/lib/offline-queue");
    void offlineFetch("/api/tasks/update-status", { id: "t1" }, "סטטוס");
    await untilSent(1);
    expect(localStorage.getItem("biz_offline_queue")).toBeNull();
  });
});
