import { beforeEach, describe, expect, it, vi } from "vitest";

// A lease saved from the property page through the send queue, so it saves
// with no signal too (owner, 2026-10-24): a new one keeps the id the app gave
// it — sent twice, it's still one lease — and a changed one is updated.

const inserts: Record<string, unknown>[] = [];
const updates: Array<{ row: Record<string, unknown>; id: unknown }> = [];
let insertError: { code: string; message: string } | null = null;

function supabase() {
  return {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.insert = (row: Record<string, unknown>) => {
        inserts.push(row);
        return builder;
      };
      builder.update = (row: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          updates.push({ row, id });
          return { error: null };
        },
      });
      builder.delete = () => ({ eq: async () => ({ error: null }) });
      builder.select = () => builder;
      builder.single = async () =>
        insertError
          ? { data: null, error: insertError }
          : {
              data: { id: (inserts.at(-1)?.id as string) ?? "db-id" },
              error: null,
            };
      return builder;
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireProfile", () => ({
  requireProfile: async () => ({
    profile: { role: "admin" },
    supabase: supabase(),
  }),
}));
vi.mock("@/lib/auth/requireRouteAccess", () => ({
  requireRouteAccess: async () => ({
    ok: true,
    value: {
      supabase: supabase(),
      user: { id: "u1" },
      profile: { role: "admin" },
    },
  }),
}));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (
    _req: Request,
    _s: unknown,
    _u: string,
    _e: string,
    handler: () => Promise<Response>,
  ) => handler(),
}));

import { POST as save } from "@/app/api/leases/save/route";
import { POST as remove } from "@/app/api/leases/delete/route";

const LEASE_ID = "0b8f7a52-6a3c-4f7e-9d61-3c2b1a0e9f11";
const LEASE = {
  customer_id: "c1",
  start_date: "2026-11-01",
  monthly_rent_amount: "4500",
  status: "active",
  period_months: "1",
};

function post(body: unknown) {
  return new Request("http://x/api/leases/save", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  insertError = null;
});

describe("saving a lease through the send queue", () => {
  it("a new one: with the app's id", async () => {
    const res = await save(
      post({ property_id: "prop1", id: LEASE_ID, lease: LEASE }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lease: { id: LEASE_ID } });
    expect(inserts[0]).toMatchObject({
      id: LEASE_ID,
      property_id: "prop1",
      customer_id: "c1",
      monthly_rent_amount: 4500,
    });
  });

  it("the same one sent again: still one lease, and done", async () => {
    insertError = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    };
    const res = await save(
      post({ property_id: "prop1", id: LEASE_ID, lease: LEASE }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lease: { id: LEASE_ID } });
  });

  it("a changed one: updated", async () => {
    const res = await save(
      post({
        property_id: "prop1",
        lease_id: LEASE_ID,
        lease: { ...LEASE, monthly_rent_amount: "4700" },
      }),
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      id: LEASE_ID,
      row: { monthly_rent_amount: 4700 },
    });
  });

  it("missing what it needs: refused, in Hebrew", async () => {
    const res = await save(
      post({
        property_id: "prop1",
        id: LEASE_ID,
        lease: { ...LEASE, customer_id: "" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "יש לבחור לקוח." });
  });

  it("deleted: done (one already gone too)", async () => {
    const res = await remove(
      new Request("http://x/api/leases/delete", {
        method: "POST",
        body: JSON.stringify({ property_id: "prop1", id: LEASE_ID }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
