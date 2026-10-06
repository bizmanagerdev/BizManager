// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Instant saves: a task moved, reordered or deleted on the device copy is sent
// through the same API route the board used before. No signal: it waits
// (never dropped for that). Refused by the server: dropped, and the page is
// told. A server that keeps failing: dropped after a few tries (a stuck
// change would hold back everything coming down).

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: {} }) }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

import { BizConnector } from "@/lib/powersync/connector";
import { DEVICE_SAVE_REFUSED_EVENT, deleteTaskOnDevice, moveTaskOnDevice, requestForChange } from "@/lib/powersync/local-writes";

type Op = { clientId: number; table: string; op: string; id: string; opData?: Record<string, unknown> };

function fakeDatabase(ops: Op[], status: string | null = "in_progress") {
  const transaction = { crud: ops, complete: vi.fn(async () => {}) };
  return {
    transaction,
    db: {
      getNextCrudTransaction: vi.fn(async () => (ops.length ? transaction : null)),
      getOptional: vi.fn(async () => (status === null ? null : { status })),
    } as unknown as Parameters<BizConnector["uploadData"]>[0],
  };
}

const fetchMock = vi.fn();
const refused: Array<{ kind: string; message: string }> = [];
window.addEventListener(DEVICE_SAVE_REFUSED_EVENT, (e) => refused.push((e as CustomEvent).detail));

describe("device saves", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    refused.length = 0;
    vi.stubGlobal("fetch", fetchMock);
  });

  it("writes the move or the delete into the device copy", async () => {
    const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({}));
    await moveTaskOnDevice({ execute } as never, "t1", "done", 1.5);
    await deleteTaskOnDevice({ execute } as never, "t2");
    expect(execute.mock.calls[0][0]).toMatch(/^UPDATE tasks SET status = \?, sort_order = \?, updated_at = \? WHERE id = \?$/);
    expect(execute.mock.calls[0][1]).toEqual(["done", 1.5, expect.any(String), "t1"]);
    expect(execute.mock.calls[1]).toEqual(["DELETE FROM tasks WHERE id = ?", ["t2"]]);
  });

  it("each change becomes the board's own API call", async () => {
    const current = vi.fn(async () => "blocked");
    expect(await requestForChange({ table: "tasks", op: "PATCH", id: "t1", opData: { status: "done", sort_order: "2" } } as never, current)).toEqual({
      kind: "task-status",
      url: "/api/tasks/update-status",
      body: { id: "t1", status: "done", sort_order: 2 },
    });
    // A reorder recorded without the status: the row's own status goes with it.
    expect((await requestForChange({ table: "tasks", op: "PATCH", id: "t1", opData: { sort_order: 3 } } as never, current))?.body).toEqual({
      id: "t1",
      status: "blocked",
      sort_order: 3,
    });
    expect(await requestForChange({ table: "tasks", op: "DELETE", id: "t9" } as never, current)).toEqual({
      kind: "task-delete",
      url: "/api/tasks/delete",
      body: { id: "t9" },
    });
    expect(await requestForChange({ table: "orders", op: "PATCH", id: "o1", opData: {} } as never, current)).toBeNull();
  });

  it("sends the batch and marks it done", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const { db, transaction } = fakeDatabase([{ clientId: 1, table: "tasks", op: "PATCH", id: "t1", opData: { status: "done", sort_order: 1 } }]);
    await new BizConnector().uploadData(db);
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/update-status", expect.objectContaining({ method: "POST" }));
    expect(transaction.complete).toHaveBeenCalledTimes(1);
  });

  it("no signal: it waits — however many times — and is never dropped for that", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const connector = new BizConnector();
    const { db, transaction } = fakeDatabase([{ clientId: 1, table: "tasks", op: "DELETE", id: "t1" }]);
    for (let i = 0; i < 10; i += 1) await expect(connector.uploadData(db)).rejects.toThrow("no connection");
    expect(transaction.complete).not.toHaveBeenCalled();
    expect(refused).toEqual([]);
  });

  it("refused by the server: dropped, and the page is told why", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "אין הרשאה" }), { status: 403 }));
    const { db, transaction } = fakeDatabase([{ clientId: 1, table: "tasks", op: "PATCH", id: "t1", opData: { status: "done" } }]);
    await new BizConnector().uploadData(db);
    expect(transaction.complete).toHaveBeenCalledTimes(1);
    expect(refused).toEqual([{ kind: "task-status", message: "אין הרשאה" }]);
  });

  it("a server that keeps failing: dropped after six tries, so nothing stays stuck", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const connector = new BizConnector();
    const { db, transaction } = fakeDatabase([{ clientId: 7, table: "tasks", op: "PATCH", id: "t1", opData: { status: "done" } }]);
    for (let i = 0; i < 5; i += 1) await expect(connector.uploadData(db)).rejects.toThrow("HTTP 500");
    await connector.uploadData(db);
    expect(transaction.complete).toHaveBeenCalledTimes(1);
    expect(refused).toHaveLength(1);
  });

  it("deleting a task that's already gone counts as done; a batch retried never sends a change twice", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Task not found" }), { status: 404 })) // delete: already gone
      .mockResolvedValueOnce(new Response("{}", { status: 503 })) // the move: server busy
      .mockResolvedValueOnce(new Response("{}", { status: 200 })); // the move, retried
    const connector = new BizConnector();
    const { db, transaction } = fakeDatabase([
      { clientId: 1, table: "tasks", op: "DELETE", id: "t1" },
      { clientId: 2, table: "tasks", op: "PATCH", id: "t2", opData: { status: "todo" } },
    ]);
    await expect(connector.uploadData(db)).rejects.toThrow("HTTP 503");
    await connector.uploadData(db);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/tasks/delete", "/api/tasks/update-status", "/api/tasks/update-status"]);
    expect(transaction.complete).toHaveBeenCalledTimes(1);
    expect(refused).toEqual([]);
  });
});
