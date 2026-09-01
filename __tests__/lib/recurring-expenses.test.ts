import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureRecurringExpensesForDate, invalidateRecurringExpensesEnsureCache } from "@/lib/recurring-expenses";

// ensureRecurringExpensesForDate is the engine behind "saving a template
// materializes its occurrences immediately" (see recurring-expenses/save's
// own comment) and is memoized per calendar day per server instance via a
// `globalThis` cache — the ONE thing standing between a page load and a
// template save both triggering the (potentially expensive) generator RPC
// twice for the same day. That memoization, and its error-recovery rules,
// are exactly what a route-level test (which mocks this module away) can't
// see — this file is where they're checked directly.

function makeSupabase(rpcImpl: (args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn(rpcImpl);
  return { rpc } as never;
}

beforeEach(() => invalidateRecurringExpensesEnsureCache());

describe("ensureRecurringExpensesForDate — the daily memo", () => {
  it("calls the RPC once and returns its createdCount on success", async () => {
    const supabase = makeSupabase(async () => ({ data: 3, error: null }));
    const result = await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    expect(result).toMatchObject({ ok: true, createdCount: 3, skippedMissingSchema: false });
    expect((supabase as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledTimes(1);
  });

  it("memoizes: a second call for the SAME day returns the cached result without calling the RPC again", async () => {
    const rpc = vi.fn(async () => ({ data: 2, error: null }));
    const supabase = { rpc } as never;
    await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15T08:00:00") });
    await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15T20:00:00") }); // same calendar day
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does NOT memoize across different calendar days", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    const supabase = { rpc } as never;
    await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-16") });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("invalidateRecurringExpensesEnsureCache forces a fresh RPC call even for the same day", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    const supabase = { rpc } as never;
    await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    invalidateRecurringExpensesEnsureCache();
    await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("coerces a numeric-string createdCount, and falls back to 0 for an unparseable one", async () => {
    const supabase1 = makeSupabase(async () => ({ data: "7", error: null }));
    const r1 = await ensureRecurringExpensesForDate(supabase1, { today: new Date("2026-05-15") });
    expect(r1.createdCount).toBe(7);

    const supabase2 = makeSupabase(async () => ({ data: "not-a-number", error: null }));
    const r2 = await ensureRecurringExpensesForDate(supabase2, { today: new Date("2026-05-16") });
    expect(r2.createdCount).toBe(0);
  });
});

describe("ensureRecurringExpensesForDate — missing-schema soft-skip", () => {
  it("treats a missing-schema RPC error as a soft, non-failing skip", async () => {
    const supabase = makeSupabase(async () => ({
      data: null,
      error: { message: 'function "generate_recurring_expenses_for_date" does not exist' },
    }));
    const result = await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    expect(result).toMatchObject({ ok: true, createdCount: 0, skippedMissingSchema: true });
  });

  it("still memoizes a missing-schema skip — a second same-day call doesn't re-query", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "could not find the function" } }));
    const supabase = { rpc } as never;
    await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("ensureRecurringExpensesForDate — real errors evict the cache so a retry can succeed", () => {
  it("returns ok:false with a Hebrew message for a real (non-schema) RPC error", async () => {
    const supabase = makeSupabase(async () => ({ data: null, error: { message: "connection reset" } }));
    const result = await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("does NOT memoize a real error — a later same-day call retries the RPC", async () => {
    let call = 0;
    const rpc = vi.fn(async () => {
      call += 1;
      return call === 1 ? { data: null, error: { message: "connection reset" } } : { data: 4, error: null };
    });
    const supabase = { rpc } as never;
    const first = await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    expect(first.ok).toBe(false);
    const second = await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    expect(second).toMatchObject({ ok: true, createdCount: 4 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("evicts the cache and rethrows when the RPC call itself throws, so a later call retries instead of replaying the rejection", async () => {
    const boom = new Error("network down");
    const rpc = vi.fn(async () => {
      throw boom;
    });
    const supabase = { rpc } as never;
    await expect(ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") })).rejects.toBe(boom);

    rpc.mockResolvedValueOnce({ data: 1, error: null } as never);
    const retried = await ensureRecurringExpensesForDate(supabase, { today: new Date("2026-05-15") });
    expect(retried).toMatchObject({ ok: true, createdCount: 1 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
