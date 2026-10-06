import { describe, it, expect, vi, beforeEach } from "vitest";

// The kept device results: worked out once and shown at once after that;
// redone only when a table they read changes; the usual page views prepared
// in the background; nothing shown from another person's database.

const computeLocalCard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/powersync/dashboard-local", () => ({
  computeLocalCard,
  LOCAL_CARD_TABLES: { tasksBoard: ["tasks", "task_members"], salesOrders: ["orders"] },
}));
vi.mock("@/lib/powersync/local-supabase", () => ({
  createLocalSupabase: () => ({}),
  LOCAL_TABLES: new Set(["tasks", "task_members", "orders", "users"]),
}));

import { getResult, peekResult, resultKey, warmResults, watchResult } from "@/lib/powersync/local-results";

type Handler = { onChange: (event: { changedTables: string[] }) => void };

function fakeDb(people = 3) {
  const db = {
    handler: null as Handler | null,
    watched: [] as string[],
    get: vi.fn(async () => ({ n: people })),
    getAll: vi.fn(async () => []),
    onChange: (handler: Handler, options: { tables: string[] }) => {
      db.handler = handler;
      db.watched = options.tables;
      return () => {};
    },
    change: (...tables: string[]) => db.handler?.onChange({ changedTables: tables.map((t) => `ps_data__${t}`) }),
  };
  return db;
}
type FakeDb = ReturnType<typeof fakeDb>;
const asDb = (db: FakeDb) => db as unknown as Parameters<typeof watchResult>[0];

const viewer = { userId: "me", role: "admin", locale: "he" as const };
const board = { kind: "tasksBoard" as const, viewer, filters: { scope: "mine", q: "" } };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(20);

describe("kept device results", () => {
  beforeEach(() => {
    computeLocalCard.mockReset();
    let n = 0;
    computeLocalCard.mockImplementation(async () => ({ version: ++n }));
  });

  it("the same filters in any order name the same result", () => {
    expect(resultKey({ ...board, filters: { q: "", scope: "mine" } })).toBe(resultKey(board));
  });

  it("worked out once; opened again, shown at once from what's kept", async () => {
    const db = fakeDb();
    const first = vi.fn();
    const stop = watchResult(asDb(db), board, { onData: first, onError: vi.fn() });
    await settle();
    expect(first).toHaveBeenLastCalledWith({ version: 1 });
    stop();

    const again = vi.fn();
    const stopAgain = watchResult(asDb(db), board, { onData: again, onError: vi.fn() });
    // Synchronously, before any new work.
    expect(again).toHaveBeenCalledWith({ version: 1 });
    stopAgain(); // closed before its quiet check runs
    expect(peekResult(asDb(db), resultKey(board))).toEqual({ data: { version: 1 } });
    // Another database (someone else signed in) never sees it.
    expect(peekResult(asDb(fakeDb()), resultKey(board))).toBeNull();
  });

  it("listens to every synced table, and redoes only what reads the changed one", async () => {
    const db = fakeDb();
    const onData = vi.fn();
    watchResult(asDb(db), board, { onData, onError: vi.fn() });
    await settle();
    expect(db.watched.sort()).toEqual(["orders", "task_members", "tasks", "users"]);
    const callsBefore = computeLocalCard.mock.calls.length;

    db.change("orders");
    await sleep(400);
    expect(computeLocalCard.mock.calls.length).toBe(callsBefore);

    db.change("task_members");
    db.change("tasks"); // a burst: one redo
    await sleep(400);
    expect(computeLocalCard.mock.calls.length).toBe(callsBefore + 1);
    expect(onData).toHaveBeenLastCalledWith({ version: callsBefore + 1 });
  });

  it("the usual views are prepared in the background, then handed over without new work", async () => {
    const db = fakeDb();
    warmResults(asDb(db), [board]);
    await sleep(400);
    expect(computeLocalCard).toHaveBeenCalledTimes(1);
    expect(peekResult(asDb(db), resultKey(board))).toEqual({ data: { version: 1 } });
    expect(await getResult(asDb(db), board)).toEqual({ version: 1 });
    expect(computeLocalCard).toHaveBeenCalledTimes(1);

    // Kept current in the background too.
    db.change("tasks");
    await sleep(400);
    expect(await getResult(asDb(db), board)).toEqual({ version: 2 });
  });

  it("a copy that holds nothing yet (rules not deployed) says so", async () => {
    const onError = vi.fn();
    watchResult(asDb(fakeDb(0)), board, { onData: vi.fn(), onError });
    await settle();
    expect(onError).toHaveBeenCalledWith("no-data", expect.anything());
    expect(computeLocalCard).not.toHaveBeenCalled();
  });
});
