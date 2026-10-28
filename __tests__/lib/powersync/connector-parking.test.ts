import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { AppSchema } from "@/lib/powersync/schema";

// Phone saves the server keeps failing are parked on the phone, not dropped
// (audit 2026-10-27; owner, 2026-10-28: "yes, build it"). They used to be
// dropped after 6 tries (~30 s) — an outage of a minute lost them. Run here on
// a real SQLite table built from the app's own device schema.

const h = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { refreshSession: h.refreshSession, getSession: vi.fn() } }),
}));
vi.mock("@/lib/sentry-lazy", () => ({
  withSentry: (report: (sentry: unknown) => void) => report({ captureMessage: h.captureMessage }),
}));
vi.mock("@/lib/powersync/device-saves-waiting", () => ({
  rowName: async () => "דוד כהן",
}));
vi.mock("@/lib/powersync/local-writes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/powersync/local-writes")>()),
  isCarriedChange: () => false,
  restoreForChange: (op: { op: string }) => (op.op === "PUT" ? { key: "order-create", draft: { customer: "c1" } } : null),
  requestForChange: async (op: { id: string; op: string }) => ({
    kind: op.op === "PUT" ? "order-create" : "order-update",
    url: op.op === "PUT" ? "/api/orders/create" : "/api/orders/update",
    body: { id: op.id },
  }),
}));

import { BizConnector, PARK_AFTER_MS, retryParkedSaves } from "@/lib/powersync/connector";
import {
  DEVICE_SAVE_PARKED_EVENT,
  PARKED_SAVE_SENT_EVENT,
  listParkedSaves,
  parkSave,
} from "@/lib/powersync/parked-saves";
import { DEVICE_SAVE_REFUSED_EVENT } from "@/lib/powersync/local-writes";

type Op = { clientId: number; table: string; op: string; id: string; opData?: Record<string, unknown> };

/** The device copy's parked_saves table, and the upload queue PowerSync hands the connector. */
function deviceCopy() {
  const sqlite = new DatabaseSync(":memory:");
  const table = AppSchema.tables.find((t) => t.name === "parked_saves")!;
  sqlite.exec(`CREATE TABLE parked_saves (id TEXT PRIMARY KEY, ${table.columns.map((c) => `"${c.name}" ${c.type}`).join(", ")})`);
  const bind = (params: unknown[] = []) => params.map((value) => (value === undefined ? null : value)) as never[];
  let queue: Op[] = [];
  const completed: number[][] = [];
  const db = {
    async execute(sql: string, params?: unknown[]) {
      sqlite.prepare(sql).run(...bind(params));
      return {};
    },
    async getOptional<T>(sql: string, params?: unknown[]) {
      return (sqlite.prepare(sql).get(...bind(params)) as T | undefined) ?? null;
    },
    async getAll<T>(sql: string, params?: unknown[]) {
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    async getNextCrudTransaction() {
      if (queue.length === 0) return null;
      const crud = queue;
      return {
        crud,
        complete: async () => {
          completed.push(crud.map((op) => op.clientId));
          queue = queue.filter((op) => !crud.includes(op));
        },
      };
    },
  };
  return {
    db: db as never,
    enqueue: (...ops: Op[]) => {
      queue = [...queue, ...ops];
    },
    completed,
    rows: () => sqlite.prepare("SELECT * FROM parked_saves ORDER BY seq").all() as Record<string, unknown>[],
  };
}

const respond = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
let events: { type: string; detail: unknown }[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const target = new EventTarget();
  events = [];
  for (const type of [DEVICE_SAVE_PARKED_EVENT, PARKED_SAVE_SENT_EVENT, DEVICE_SAVE_REFUSED_EVENT]) {
    target.addEventListener(type, (event) => events.push({ type, detail: (event as CustomEvent).detail }));
  }
  vi.stubGlobal("window", target);
  h.refreshSession.mockReset();
  h.captureMessage.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const keyOf = (call: unknown[]) => (call[1] as { headers: Record<string, string> }).headers["Idempotency-Key"];
const sentryTitles = () => h.captureMessage.mock.calls.map((call) => call[0]);

describe("uploading a phone save", () => {
  it("a 401 (the login ran out): a fresh login, then the same save again at once — not a failure", async () => {
    const copy = deviceCopy();
    copy.enqueue({ clientId: 1, table: "orders", op: "PATCH", id: "o1" });
    fetchMock.mockResolvedValueOnce(respond(401)).mockResolvedValueOnce(respond(200));
    h.refreshSession.mockResolvedValue({ data: { session: { access_token: "new" } }, error: null });

    await new BizConnector().uploadData(copy.db);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keyOf(fetchMock.mock.calls[0])).toBe(keyOf(fetchMock.mock.calls[1]));
    expect(copy.completed).toEqual([[1]]);
    expect(copy.rows()).toEqual([]);
  });

  it("a 401 with no fresh login to be had counts as a failure (tried again, not dropped)", async () => {
    const copy = deviceCopy();
    copy.enqueue({ clientId: 1, table: "orders", op: "PATCH", id: "o1" });
    fetchMock.mockResolvedValue(respond(401));
    h.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("refresh failed") });

    await expect(new BizConnector().uploadData(copy.db)).rejects.toThrow("HTTP 401");
    expect(copy.completed).toEqual([]);
  });

  it("server errors: tried again for 2 minutes, then parked with its request and key — not dropped", async () => {
    const copy = deviceCopy();
    const connector = new BizConnector();
    copy.enqueue({ clientId: 7, table: "orders", op: "PUT", id: "o9" });
    fetchMock.mockResolvedValue(respond(503));

    await expect(connector.uploadData(copy.db)).rejects.toThrow("HTTP 503");
    vi.setSystemTime(Date.now() + PARK_AFTER_MS - 1000);
    await expect(connector.uploadData(copy.db)).rejects.toThrow("HTTP 503");
    expect(copy.rows()).toEqual([]);

    vi.setSystemTime(Date.now() + 2000);
    await connector.uploadData(copy.db);

    // The queue moves on (the copy keeps syncing), and the save is kept.
    expect(copy.completed).toEqual([[7]]);
    const [row] = copy.rows();
    expect(row).toMatchObject({
      tbl: "orders",
      row_id: "o9",
      kind: "order-create",
      idem_key: keyOf(fetchMock.mock.calls[0]),
      label: "הזמנה חדשה: דוד כהן",
      last_error: "HTTP 503",
    });
    expect(JSON.parse(String(row.request))).toEqual({ kind: "order-create", url: "/api/orders/create", body: { id: "o9" } });
    expect(JSON.parse(String(row.restore))).toEqual({ key: "order-create", draft: { customer: "c1" } });
    expect(events.map((e) => e.type)).toEqual([DEVICE_SAVE_PARKED_EVENT]);
    expect(sentryTitles()).toEqual(["PowerSync: a device save was parked"]);
  });

  it("no connection never parks it, however long it lasts", async () => {
    const copy = deviceCopy();
    const connector = new BizConnector();
    copy.enqueue({ clientId: 1, table: "orders", op: "PATCH", id: "o1" });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(connector.uploadData(copy.db)).rejects.toThrow("no connection");
    vi.setSystemTime(Date.now() + 60 * 60_000);
    await expect(connector.uploadData(copy.db)).rejects.toThrow("no connection");
    expect(copy.rows()).toEqual([]);
    expect(copy.completed).toEqual([]);
  });

  it("refused (the server said no) is still dropped, and says why", async () => {
    const copy = deviceCopy();
    copy.enqueue({ clientId: 1, table: "orders", op: "PATCH", id: "o1" });
    fetchMock.mockResolvedValue(respond(403, { error: "No access" }));

    await new BizConnector().uploadData(copy.db);

    expect(copy.rows()).toEqual([]);
    expect(copy.completed).toEqual([[1]]);
    expect(events).toEqual([{ type: DEVICE_SAVE_REFUSED_EVENT, detail: { kind: "order-update", message: "No access" } }]);
  });

  it("a later save of a parked row waits behind it, so the older one can't land on top of it", async () => {
    const copy = deviceCopy();
    await parkSave(copy.db, {
      table: "orders",
      rowId: "o1",
      request: { kind: "order-update", url: "/api/orders/update", body: { id: "o1" } },
      key: "ps:orders:o1:PATCH:1",
      restore: null,
      label: "עריכת הזמנה",
      error: "HTTP 503",
    });
    copy.enqueue({ clientId: 2, table: "orders", op: "PATCH", id: "o1" });

    await new BizConnector().uploadData(copy.db);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(copy.rows().map((row) => row.idem_key)).toEqual(["ps:orders:o1:PATCH:1", "ps:orders:o1:PATCH:2"]);
    expect(copy.completed).toEqual([[2]]);
  });
});

describe("sending parked saves again", () => {
  const park = (copy: ReturnType<typeof deviceCopy>, rowId: string, n: number, restore = false) =>
    parkSave(copy.db, {
      table: "orders",
      rowId,
      request: { kind: "order-update", url: "/api/orders/update", body: { id: rowId, n } },
      key: `ps:orders:${rowId}:PATCH:${n}`,
      restore: restore ? { key: "order-create", draft: { customer: "c1" } } : null,
      label: `עריכת הזמנה ${rowId}`,
      error: "HTTP 503",
    });
  const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as { body: string }).body)) as { id: string; n: number };

  it("goes up with the same key it was parked with, and leaves the list", async () => {
    const copy = deviceCopy();
    await park(copy, "o1", 1);
    fetchMock.mockResolvedValue(respond(200));

    await retryParkedSaves(copy.db);

    expect(keyOf(fetchMock.mock.calls[0])).toBe("ps:orders:o1:PATCH:1");
    expect(await listParkedSaves(copy.db)).toEqual([]);
    expect(events).toEqual([{ type: PARKED_SAVE_SENT_EVENT, detail: { kind: "order-update", label: "עריכת הזמנה o1" } }]);
    expect(sentryTitles()).toEqual(["PowerSync: a device save was parked and went up"]);
  });

  it("still failing: stays with the try counted, the later saves of its row wait, other rows go", async () => {
    const copy = deviceCopy();
    await park(copy, "o1", 1);
    await park(copy, "o1", 2);
    await park(copy, "o2", 3);
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) =>
      JSON.parse(init.body).id === "o1" ? respond(500) : respond(200)
    );

    await retryParkedSaves(copy.db);

    expect(fetchMock.mock.calls.map(bodyOf).map((body) => body.n)).toEqual([1, 3]);
    const left = await listParkedSaves(copy.db);
    expect(left.map((save) => save.key)).toEqual(["ps:orders:o1:PATCH:1", "ps:orders:o1:PATCH:2"]);
    expect(left[0]).toMatchObject({ tries: 1, lastError: "HTTP 500" });
  });

  it("refused when sent again: leaves the list, says why, and a new order's form comes back", async () => {
    const copy = deviceCopy();
    await park(copy, "o1", 1, true);
    fetchMock.mockResolvedValue(respond(422, { error: "invalid" }));

    await retryParkedSaves(copy.db);

    expect(await listParkedSaves(copy.db)).toEqual([]);
    expect(events).toEqual([
      {
        type: DEVICE_SAVE_REFUSED_EVENT,
        detail: { kind: "order-update", message: "invalid", restore: { key: "order-create", draft: { customer: "c1" } } },
      },
    ]);
  });

  it("no connection: the first one is tried, the rest wait for next time", async () => {
    const copy = deviceCopy();
    await park(copy, "o1", 1);
    await park(copy, "o2", 2);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await retryParkedSaves(copy.db);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await listParkedSaves(copy.db)).length).toBe(2);
  });

  it("parked once per key, however often its batch comes round", async () => {
    const copy = deviceCopy();
    await park(copy, "o1", 1);
    await park(copy, "o1", 1);
    expect(copy.rows().length).toBe(1);
  });
});
