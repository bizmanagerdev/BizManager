import { describe, it, expect, vi, beforeEach } from "vitest";

// The properties list in the owner's own order (2026-10-21): only the
// properties whose place changed are written — each write is a line in the
// activity log, and a drag one place down is two of them, not the whole list.

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const updates: Array<{ id: unknown; row: Record<string, unknown> }> = [];
let stored: Array<{ id: string; sort_order: number | null }> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireProfile", () => ({
  requireProfile: async () => ({
    profile: { role: "admin" },
    supabase: {
      from: () => ({
        select: () => ({ in: () => Promise.resolve({ data: stored, error: null }) }),
        update: (row: Record<string, unknown>) => ({
          eq: (_column: string, id: unknown) => {
            updates.push({ id, row });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    },
  }),
}));

import { setPropertyOrder } from "@/app/(app)/properties/actions";

beforeEach(() => {
  updates.length = 0;
});

describe("saving the properties' order", () => {
  it("the first time: every property gets its place", async () => {
    stored = [1, 2, 3].map((n) => ({ id: ID(n), sort_order: null }));
    expect(await setPropertyOrder([ID(2), ID(1), ID(3)])).toEqual({ ok: true });
    expect(updates).toEqual([
      { id: ID(2), row: { sort_order: 1 } },
      { id: ID(1), row: { sort_order: 2 } },
      { id: ID(3), row: { sort_order: 3 } },
    ]);
  });

  it("after that, a drag one place down writes the two that moved", async () => {
    stored = [1, 2, 3, 4].map((n) => ({ id: ID(n), sort_order: n }));
    expect(await setPropertyOrder([ID(1), ID(3), ID(2), ID(4)])).toEqual({ ok: true });
    expect(updates).toEqual([
      { id: ID(3), row: { sort_order: 2 } },
      { id: ID(2), row: { sort_order: 3 } },
    ]);
  });

  it("refuses an order that isn't one", async () => {
    expect(await setPropertyOrder([ID(1), ID(1)])).toMatchObject({ ok: false });
    expect(await setPropertyOrder(["not-an-id"])).toMatchObject({ ok: false });
    expect(updates).toEqual([]);
  });
});
