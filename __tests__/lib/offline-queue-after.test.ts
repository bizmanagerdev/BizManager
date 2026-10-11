// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A save that waited for the connection (a new expense, project, payment…)
// used to lose its files: the save was queued, the files were dropped (owner,
// 2026-10-11). Now the files — and follow-up saves like a new customer's
// contacts — wait on the device too, and go out once the save has, with the
// id it was given.

/** Just enough IndexedDB for lib/offline-upload.ts. */
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

let online = true;
const sent: Array<{ url: string; body: unknown }> = [];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sent.length = 0;
  online = false;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  vi.stubGlobal("indexedDB", fakeIndexedDB());
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("a save that waited, and what waits on it", () => {
  it("sends the files and the follow-ups with the id the save was given", async () => {
    const queue = await import("@/lib/offline-queue");
    const uploads = await import("@/lib/offline-upload");

    const created = await queue.offlineFetch("/api/expenses/create", { amount: 50 }, "הוצאה חדשה", { idempotent: true });
    expect(created.queued).toBe(true);
    const key = created.queued ? created.key! : "";
    expect(key).toBeTruthy();

    await uploads.queueUploadsAfter({ key, idPath: "expense.id" }, [
      {
        url: "/api/financial-attachments/upload",
        fields: { entity_type: "expense", entity_id: "{id}" },
        file: new File(["x"], "receipt.jpg", { type: "image/jpeg" }),
        label: "receipt.jpg",
      },
    ]);
    queue.enqueueAfter({ key, idPath: "expense.id" }, { url: "/api/follow-up", body: { expense_id: "{id}", note: "n" }, label: "המשך" });

    online = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].filter(([, v]) => typeof v === "string")) : JSON.parse(String(init.body));
        sent.push({ url, body });
        if (url === "/api/expenses/create") return json(200, { expense: { id: "expense-1" } });
        return json(200, { ok: true });
      })
    );

    await queue.processQueue();
    await uploads.processUploadQueue();

    expect(sent.map((s) => s.url)).toEqual(["/api/expenses/create", "/api/follow-up", "/api/financial-attachments/upload"]);
    expect(sent[1].body).toEqual({ expense_id: "expense-1", note: "n" });
    expect(sent[2].body).toMatchObject({ entity_type: "expense", entity_id: "expense-1" });
    expect(await uploads.getUploadQueueLength()).toBe(0);
  });

  it("parks what waits on a save that was refused, instead of sending it to nowhere", async () => {
    const queue = await import("@/lib/offline-queue");
    const uploads = await import("@/lib/offline-upload");

    const created = await queue.offlineFetch("/api/expenses/create", { amount: -1 }, "הוצאה חדשה", { idempotent: true });
    const key = created.queued ? created.key! : "";
    await uploads.queueUploadsAfter({ key, idPath: "expense.id" }, [
      {
        url: "/api/financial-attachments/upload",
        fields: { entity_type: "expense", entity_id: "{id}" },
        file: new File(["x"], "receipt.jpg", { type: "image/jpeg" }),
        label: "receipt.jpg",
      },
    ]);

    online = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        sent.push({ url, body: null });
        return json(400, { error: "סכום לא תקין" });
      })
    );

    await queue.processQueue();
    await uploads.processUploadQueue();

    expect(sent.map((s) => s.url)).toEqual(["/api/expenses/create"]);
    expect(await uploads.getUploadQueueLength()).toBe(0);
    expect(await uploads.getUploadFailedLength()).toBe(1);
  });

  it("holds the files while their save hasn't gone out yet", async () => {
    const queue = await import("@/lib/offline-queue");
    const uploads = await import("@/lib/offline-upload");

    const created = await queue.offlineFetch("/api/expenses/create", { amount: 50 }, "הוצאה חדשה", { idempotent: true });
    const key = created.queued ? created.key! : "";
    await uploads.queueUploadsAfter({ key, idPath: "expense.id" }, [
      {
        url: "/api/financial-attachments/upload",
        fields: { entity_type: "expense", entity_id: "{id}" },
        file: new File(["x"], "receipt.jpg", { type: "image/jpeg" }),
        label: "receipt.jpg",
      },
    ]);

    online = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (sent.push({ url, body: null }), json(200, {}))));
    // The files' pass alone (the save still waiting): nothing goes out.
    await uploads.processUploadQueue();
    expect(sent).toHaveLength(0);
    expect(await uploads.getUploadQueueLength()).toBe(1);
  });
});
