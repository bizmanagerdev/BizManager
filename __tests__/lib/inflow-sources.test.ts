import { describe, it, expect, vi } from "vitest";
import { nextMonthlyDate } from "@/lib/inflow-sources";

// The incoming half of "what happens every month". The loaders themselves are
// thin reads; what is worth locking is the date walk they all share and the
// promise that these rows never claim to be configurable — there is nowhere to
// store settings for them.

describe("nextMonthlyDate", () => {
  it("returns this month's day when it is still ahead", () => {
    expect(nextMonthlyDate(20, "2026-09-16")).toBe("2026-09-20");
  });

  it("returns today when the day is today", () => {
    expect(nextMonthlyDate(16, "2026-09-16")).toBe("2026-09-16");
  });

  it("rolls to next month once the day has passed", () => {
    expect(nextMonthlyDate(5, "2026-09-16")).toBe("2026-10-05");
  });

  it("clamps to a short month instead of spilling into the next one", () => {
    // No 31st in September, and no 30th in February.
    expect(nextMonthlyDate(31, "2026-09-16")).toBe("2026-09-30");
    expect(nextMonthlyDate(30, "2026-02-15")).toBe("2026-02-28");
  });

  it("crosses the year end", () => {
    expect(nextMonthlyDate(5, "2026-12-16")).toBe("2027-01-05");
  });
});

describe("loadInflowSources", () => {
  it("survives a table it cannot read, one source at a time", async () => {
    // Best-effort by design: a missing lease table must not cost the list its
    // loan rows.
    const { loadInflowSources } = await import("@/lib/inflow-sources");
    const supabase = {
      from: () => {
        throw new Error("nope");
      },
    } as never;
    await expect(loadInflowSources(supabase, { todayIso: "2026-09-16" })).resolves.toEqual([]);
  });
});

describe("incoming source rows", () => {
  it("are marked incoming and NOT configurable", async () => {
    // outflow_source_settings only knows salary/loan/card, so an incoming row
    // must never render settings controls it cannot save.
    const { loadRentSources } = await import("@/lib/inflow-sources");
    const leases = [
      { id: "L1", property_id: "p1", start_date: "2026-01-10", end_date: null, monthly_rent_amount: 4000, status: "active" },
    ];
    const supabase = {
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "not", "gte", "order", "limit"]) {
          builder[m] = () => builder;
        }
        const data = table === "lease_agreements" ? leases : [{ id: "p1", name: null, address: "הרצל 5" }];
        // `await`ed directly by the loader.
        (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
        return builder;
      },
    } as never;
    const rows = await loadRentSources(supabase, { todayIso: "2026-09-16" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "rent",
      key: "L1",
      direction: "in",
      configurable: false,
      amount: 4000,
      monthly: true,
      href: "/properties/p1",
    });
    // The lease's start day is the rent day — the lease has no day column.
    expect(rows[0].nextDate).toBe("2026-10-10");
    expect(rows[0].scheduleLabel).toBe("10 לכל חודש");
  });

  it("drops a lease that has already ended", async () => {
    const { loadRentSources } = await import("@/lib/inflow-sources");
    const leases = [
      { id: "L2", property_id: "p1", start_date: "2025-01-10", end_date: "2026-05-31", monthly_rent_amount: 4000, status: "active" },
    ];
    const supabase = {
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "not", "gte", "order", "limit"]) builder[m] = () => builder;
        const data = table === "lease_agreements" ? leases : [{ id: "p1", name: null, address: "הרצל 5" }];
        (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
        return builder;
      },
    } as never;
    await expect(loadRentSources(supabase, { todayIso: "2026-09-16" })).resolves.toEqual([]);
  });
});

vi.mock("@/lib/loans", () => ({ fetchLoans: async () => [] }));

describe("loadSettlementSource — the next deposit's real total", () => {
  // Not "משתנה": it is exactly what has been taken so far for that date, and it
  // grows as more card payments are recorded for it.
  function client(payments: unknown[]) {
    return {
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        for (const m of ["select", "eq", "not", "gte", "or", "order", "limit"]) b[m] = () => b;
        b.in = () => Promise.resolve({ data: [], error: null });
        (b as { then: unknown }).then = (resolve: (v: unknown) => void) =>
          resolve({ data: table === "payments" ? payments : [], error: null });
        return b;
      },
    } as never;
  }
  const pay = (over: Record<string, unknown>) => ({
    payment_method: "credit_card", payment_status: "cleared", order_id: null, project_id: null, notes: null, ...over,
  });

  it("sums the payments landing on the NEXT date and lists them", async () => {
    const { loadSettlementSource } = await import("@/lib/inflow-sources");
    const [row] = await loadSettlementSource(
      client([
        pay({ id: "a", payment_date: "2026-09-01", due_date: "2026-10-10", amount_total: 1000, notes: "חנות" }),
        pay({ id: "b", payment_date: "2026-09-05", due_date: "2026-10-10", amount_total: 500 }),
        // A later deposit — not part of the next one.
        pay({ id: "c", payment_date: "2026-10-02", due_date: "2026-11-10", amount_total: 9000 }),
      ]),
      { todayIso: "2026-09-17" }
    );
    expect(row.nextDate).toBe("2026-10-10");
    expect(row.amount).toBe(1500);
    expect(row.breakdown?.map((p) => p.id).sort()).toEqual(["a", "b"]);
    // Still not a FIXED monthly figure, so it stays out of the monthly total.
    expect(row.monthly).toBe(false);
    // Its account can be chosen; nothing else about it can.
    expect(row.configurable).toBe("account");
  });

  it("ignores bounced payments", async () => {
    const { loadSettlementSource } = await import("@/lib/inflow-sources");
    const [row] = await loadSettlementSource(
      client([
        pay({ id: "a", payment_date: "2026-09-01", due_date: "2026-10-10", amount_total: 1000 }),
        pay({ id: "bounced", payment_date: "2026-09-02", due_date: "2026-10-10", amount_total: 700, payment_status: "rejected" }),
      ]),
      { todayIso: "2026-09-17" }
    );
    expect(row.amount).toBe(1000);
  });

  it("counts card payments that never had a due date — they land on the 10th too", async () => {
    const { loadSettlementSource } = await import("@/lib/inflow-sources");
    const [row] = await loadSettlementSource(
      client([
        pay({ id: "old", payment_date: "2026-09-03", due_date: null, amount_total: 400 }),
        pay({ id: "same-day", payment_date: "2026-09-08", due_date: "2026-09-08", amount_total: 100 }),
        // August's payments landed on September 10 — already past.
        pay({ id: "past", payment_date: "2026-08-20", due_date: null, amount_total: 999 }),
      ]),
      { todayIso: "2026-09-17" }
    );
    expect(row.nextDate).toBe("2026-10-10");
    expect(row.amount).toBe(500);
  });

  it("no upcoming card payments means no row", async () => {
    const { loadSettlementSource } = await import("@/lib/inflow-sources");
    await expect(loadSettlementSource(client([]), { todayIso: "2026-09-17" })).resolves.toEqual([]);
  });
});
