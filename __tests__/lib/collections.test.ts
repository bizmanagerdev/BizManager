import { describe, it, expect } from "vitest";
import { computeSourceCollection } from "@/lib/collections";

const TODAY = "2026-06-02";

function run(over: Partial<Parameters<typeof computeSourceCollection>[0]>) {
  return computeSourceCollection({
    total: 680,
    collected: 0,
    pending: 0,
    overdue: 0,
    outstanding: 680,
    nextDueDate: null,
    referenceDate: "2026-06-01",
    dueDate: null,
    today: TODAY,
    ...over,
  });
}

describe("computeSourceCollection", () => {
  it("unscheduled money with a FUTURE due date is expected (awaiting), not unpaid/late", () => {
    // Order on שוטף+60: dated 01/06, due 29/08 — a real future term the customer
    // agreed to, so it is genuinely "expected" even with nothing registered yet.
    const r = run({ dueDate: "2026-08-29" });
    expect(r.status).toBe("awaiting");
    expect(r.expected).toBe(680);
    expect(r.late).toBe(0);
    expect(r.daysLate).toBe(0);
  });

  it("an immediate-term order placed today with no payment is unpaid, not 'expected'", () => {
    // referenceDate = today, מיידי terms (no dueDate) → due now, nothing registered.
    // Pays-on-the-spot money is not "expected" — it is simply not paid yet.
    const r = run({ referenceDate: TODAY, dueDate: null });
    expect(r.status).toBe("unpaid");
    expect(r.expected).toBe(0);
    expect(r.late).toBe(0);
  });

  it("unscheduled money past its due date is overdue, with a day count", () => {
    const r = run({ referenceDate: "2026-04-01", dueDate: "2026-04-01" });
    expect(r.status).toBe("overdue");
    expect(r.late).toBe(680);
    expect(r.daysLate).toBe(62);
  });

  it("falls back to the reference date (מיידי) when no due date is given", () => {
    // referenceDate 2026-06-01 < today → late.
    expect(run({ dueDate: null }).status).toBe("overdue");
  });

  it("future-scheduled pending payments are awaiting", () => {
    const r = run({ total: 1020, outstanding: 1020, pending: 1020, overdue: 0, nextDueDate: "2026-06-26", dueDate: "2026-08-01" });
    expect(r.status).toBe("awaiting");
    expect(r.expected).toBe(1020);
  });

  it("a pending payment past its due date is overdue", () => {
    const r = run({ pending: 680, overdue: 680, nextDueDate: "2026-05-20", dueDate: "2026-08-29" });
    expect(r.status).toBe("overdue");
    expect(r.late).toBe(680);
  });

  it("fully collected → collected", () => {
    expect(run({ collected: 680, outstanding: 0 }).status).toBe("collected");
  });

  it("partly collected with the rest not yet late → partial", () => {
    const r = run({ collected: 400, outstanding: 280, dueDate: "2026-08-29" });
    expect(r.status).toBe("partial");
  });

  it("blockOverdue (open order) is never late — past-due unscheduled reads unpaid", () => {
    const r = run({ referenceDate: "2026-04-01", dueDate: "2026-04-01", blockOverdue: true });
    expect(r.status).toBe("unpaid");
    expect(r.late).toBe(0);
  });
});
