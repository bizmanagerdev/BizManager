import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { IDEMPOTENCY_HEADER, PENDING_RETRY_AFTER_S, PROCESSING_EXPIRES_MS, withIdempotency } from "@/lib/idempotency";
import { isStillWorking } from "@/lib/still-working";

// withIdempotency is the ONLY thing standing between a flaky offline retry
// and a duplicated write (or a double side-effect) — every API route that
// wraps itself in it (payments/create, orders/payments/create,
// payroll/sessions/create, ...) trusts it completely, and every test of
// those routes mocks it away as a transparent passthrough. This file is
// where the actual dedup contract gets checked for real.

function req(key?: string) {
  const headers = new Headers();
  if (key !== undefined) headers.set(IDEMPOTENCY_HEADER, key);
  return new Request("http://test/api/x", { method: "POST", headers });
}

type SupaResp = { data?: unknown; error: { code?: string; message?: string } | null };

function makeSupabase(
  opts: { insertError?: SupaResp["error"]; existingRow?: unknown; takeover?: boolean } = {}
) {
  const calls = {
    insert: [] as unknown[],
    update: [] as unknown[],
    deleted: 0,
    selected: 0,
    eq: [] as Array<[string, unknown]>,
    lt: [] as Array<[string, unknown]>,
  };
  const from = () => {
    const builder: Record<string, unknown> = {};
    let updating = false;
    builder.insert = (values: unknown) => {
      calls.insert.push(values);
      return Promise.resolve({ error: opts.insertError ?? null });
    };
    builder.select = () => {
      calls.selected += 1;
      return builder;
    };
    builder.eq = (col: string, value: unknown) => {
      calls.eq.push([col, value]);
      return builder;
    };
    builder.lt = (col: string, value: unknown) => {
      calls.lt.push([col, value]);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: opts.existingRow ?? null, error: null });
    builder.update = (values: unknown) => {
      calls.update.push(values);
      updating = true;
      return builder;
    };
    builder.delete = () => {
      calls.deleted += 1;
      return builder;
    };
    // .update(...).eq(...) and .delete().eq(...) are awaited directly with no
    // further .maybeSingle() in the real route — make the chain itself thenable.
    // Taking over a dead claim (update … .lt(…).select()) finds it when `takeover`.
    builder.then = (onF: (v: SupaResp) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: updating && opts.takeover ? [{ key: "k" }] : null, error: null }).then(onF, onR);
    return builder;
  };
  return { from, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("withIdempotency — no key", () => {
  it("runs the handler directly with no DB interaction at all", async () => {
    const database = makeSupabase();
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await withIdempotency(req(), database as never, "u1", "test/ep", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(database.calls.insert).toHaveLength(0);
  });

  it("also runs directly for a blank/whitespace-only key", async () => {
    const database = makeSupabase();
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    await withIdempotency(req("   "), database as never, "u1", "test/ep", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(database.calls.insert).toHaveLength(0);
  });
});

describe("withIdempotency — fresh key", () => {
  it("claims the key, runs the handler once, then caches a successful (2xx) response", async () => {
    const database = makeSupabase();
    const handler = vi.fn(async () => NextResponse.json({ id: "row-1" }, { status: 201 }));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    expect(database.calls.insert[0]).toMatchObject({ key: "key-1", user_id: "u1", endpoint: "test/ep", status: "processing" });
    expect(database.calls.update[0]).toMatchObject({ status: "done", response_status: 201, response_body: { id: "row-1" } });
    expect(database.calls.deleted).toBe(0);
  });

  it("releases the claim (deletes it) when the handler returns a non-2xx response, without caching it", async () => {
    const database = makeSupabase();
    const handler = vi.fn(async () => NextResponse.json({ error: "bad input" }, { status: 400 }));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(res.status).toBe(400);
    expect(database.calls.deleted).toBe(1);
    expect(database.calls.update).toHaveLength(0);
  });

  it("releases the claim and re-throws when the handler itself throws", async () => {
    const database = makeSupabase();
    const boom = new Error("boom");
    const handler = vi.fn(async () => {
      throw boom;
    });
    await expect(withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler)).rejects.toBe(boom);
    expect(database.calls.deleted).toBe(1);
  });

  it("fails open (runs the handler, no caching attempt) when the claim insert fails for a reason OTHER than a duplicate key", async () => {
    const database = makeSupabase({ insertError: { code: "53300", message: "too many connections" } });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(database.calls.selected).toBe(0);
    expect(database.calls.update).toHaveLength(0);
    expect(database.calls.deleted).toBe(0);
  });
});

describe("withIdempotency — replayed key (a 23505 unique-violation on the claim insert)", () => {
  it("returns the CACHED response for a key whose original request already finished, without re-running the handler", async () => {
    const database = makeSupabase({
      insertError: { code: "23505" },
      existingRow: { status: "done", response_status: 201, response_body: { id: "row-1" } },
    });
    const handler = vi.fn(async () => NextResponse.json({ id: "SHOULD-NOT-RUN" }));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "row-1" });
  });

  it("asks to try again shortly (never the handler) while the original request is still in flight", async () => {
    const database = makeSupabase({
      insertError: { code: "23505" },
      existingRow: { status: "processing", created_at: new Date(Date.now() - 60_000).toISOString() },
    });
    const handler = vi.fn(async () => NextResponse.json({ id: "SHOULD-NOT-RUN" }));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(handler).not.toHaveBeenCalled();
    // A 503 every phone already sends again — a 202 ("accepted") made it throw the save away.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe(String(PENDING_RETRY_AFTER_S));
    const body = await res.json();
    expect(body).toMatchObject({ pending: true });
    expect(isStillWorking(res.status, body)).toBe(true);
    expect(database.calls.update).toHaveLength(0);
  });

  it("asks to try again if the claim row can't be found (its first send just failed and let go of it)", async () => {
    const database = makeSupabase({ insertError: { code: "23505" }, existingRow: null });
    const handler = vi.fn(async () => NextResponse.json({}));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });

  it("looks the key up as the person's own", async () => {
    const database = makeSupabase({
      insertError: { code: "23505" },
      existingRow: { status: "done", response_status: 200, response_body: { ok: true } },
    });
    await withIdempotency(req("key-1"), database as never, "u1", "test/ep", vi.fn());
    expect(database.calls.eq).toEqual([
      ["user_id", "u1"],
      ["key", "key-1"],
    ]);
  });
});

// A first send cut off on the server (a timeout, a restart) left its claim
// "processing" for good, and every resend was told "still working" (audit
// 2026-10-27): after PROCESSING_EXPIRES_MS the next resend does the work.
describe("withIdempotency — a claim left 'processing' by a request that died", () => {
  const dead = () => ({ status: "processing", created_at: new Date(Date.now() - PROCESSING_EXPIRES_MS - 60_000).toISOString() });

  it("is taken over by the next resend, which does the work and caches its answer", async () => {
    const database = makeSupabase({ insertError: { code: "23505" }, existingRow: dead(), takeover: true });
    const handler = vi.fn(async () => NextResponse.json({ id: "row-1" }, { status: 201 }));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    // Taken over only while still processing and still expired: one resend wins.
    expect(database.calls.update[0]).toEqual({ created_at: expect.any(String) });
    expect(database.calls.eq).toEqual(expect.arrayContaining([["status", "processing"]]));
    expect(database.calls.lt[0][0]).toBe("created_at");
    expect(database.calls.update[1]).toMatchObject({ status: "done", response_status: 201, response_body: { id: "row-1" } });
  });

  it("another resend that took it over first: this one is asked to try again", async () => {
    const database = makeSupabase({ insertError: { code: "23505" }, existingRow: dead(), takeover: false });
    const handler = vi.fn(async () => NextResponse.json({}));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });

  it("a claim not yet expired is never taken over", async () => {
    const database = makeSupabase({
      insertError: { code: "23505" },
      existingRow: { status: "processing", created_at: new Date(Date.now() - PROCESSING_EXPIRES_MS + 60_000).toISOString() },
      takeover: true,
    });
    const handler = vi.fn(async () => NextResponse.json({}));
    const res = await withIdempotency(req("key-1"), database as never, "u1", "test/ep", handler);
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(database.calls.update).toHaveLength(0);
  });
});
