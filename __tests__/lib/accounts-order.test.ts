import { describe, it, expect, vi, beforeEach } from "vitest";

// The accounts in the owner's own order, dragged on the חשבונות page and kept
// on each account's sort_order for everyone (owner, 2026-10-25).

type Call = { table: string; op: string; values?: Record<string, unknown>; id?: string };
const calls: Call[] = [];
let accountsTable: Array<{ id: string; sort_order: number | null }> = [];
let failUpdate = false;

function client() {
  return {
    from: (table: string) => {
      let op = "select";
      let values: Record<string, unknown> | undefined;
      const self: Record<string, unknown> = {};
      self.select = () => self;
      self.in = () => self;
      self.order = () => self;
      self.limit = () => self;
      self.update = (v: Record<string, unknown>) => {
        op = "update";
        values = v;
        return self;
      };
      self.insert = (v: Record<string, unknown>) => {
        op = "insert";
        values = v;
        calls.push({ table, op, values });
        return self;
      };
      self.eq = (_col: string, id: string) => {
        calls.push({ table, op, values, id });
        return self;
      };
      self.single = () => Promise.resolve({ data: { id: "new" }, error: null });
      self.maybeSingle = () =>
        Promise.resolve({
          data: [...accountsTable].sort((a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0))[0] ?? null,
          error: null,
        });
      self.then = (onF: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(
          op === "update"
            ? { data: null, error: failUpdate ? { message: "denied" } : null }
            : { data: accountsTable, error: null }
        ).then(onF);
      return self;
    },
  };
}

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => client() }));

import { saveAccountDirect, saveAccountOrderDirect } from "@/lib/accounts/accountsClient";

beforeEach(() => {
  calls.length = 0;
  failUpdate = false;
  accountsTable = [
    { id: "a", sort_order: 0 },
    { id: "b", sort_order: 0 },
    { id: "c", sort_order: 0 },
  ];
});

describe("saveAccountOrderDirect", () => {
  it("gives each account its place, 1 on, as dragged", async () => {
    expect(await saveAccountOrderDirect(["c", "a", "b"])).toEqual({ ok: true });
    expect(calls.filter((c) => c.op === "update").map((c) => [c.id, c.values?.sort_order])).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("writes only the accounts whose place changed", async () => {
    accountsTable = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
      { id: "c", sort_order: 3 },
    ];
    await saveAccountOrderDirect(["a", "c", "b"]);
    expect(calls.filter((c) => c.op === "update").map((c) => [c.id, c.values?.sort_order])).toEqual([
      ["c", 2],
      ["b", 3],
    ]);
  });

  it("says so when the database refuses, and refuses an order with an account twice", async () => {
    failUpdate = true;
    expect(await saveAccountOrderDirect(["b", "a", "c"])).toEqual({ ok: false, error: "denied" });
    expect(await saveAccountOrderDirect(["a", "a"])).toMatchObject({ ok: false });
    expect(await saveAccountOrderDirect([])).toMatchObject({ ok: false });
  });
});

describe("saveAccountDirect keeps the owner's order", () => {
  const form = { name: "מזרחי", kind: "bank", opening_balance: 0, opening_date: "2026-07-01" };

  it("an edit that doesn't name a place leaves the account's place alone", async () => {
    await saveAccountDirect({ ...form, id: "b" });
    const update = calls.find((c) => c.op === "update");
    expect(update?.id).toBe("b");
    expect(update?.values).not.toHaveProperty("sort_order");
  });

  it("a new account joins the end of the order", async () => {
    accountsTable = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 4 },
    ];
    await saveAccountDirect(form);
    expect(calls.find((c) => c.op === "insert")?.values?.sort_order).toBe(5);
  });
});
