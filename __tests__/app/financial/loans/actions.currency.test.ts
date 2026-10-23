import { describe, expect, it, vi, beforeEach } from "vitest";

// Loans in US$ (2026-10-23): a loan's amounts typed in its currency become
// shekels at the day's rate; its repayments are in the loan's currency, each
// at its own day's rate; its plan at the rate the loan was made.

const { requireProfile } = vi.hoisted(() => ({ requireProfile: vi.fn() }));
vi.mock("@/lib/auth/requireProfile", () => ({ requireProfile }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addRepayment, createLoan, updateLoan, type LoanInput } from "@/app/(app)/financial/loans/actions";

type Call = { table: string; op: string; payload?: unknown };

function fakeSupabase({ loan = null as Record<string, unknown> | null, repaymentCount = 0, rate = 3.107 } = {}) {
  const calls: Call[] = [];
  const rpc = vi.fn(async () => ({ data: rate, error: null }));
  const from = (table: string) => {
    let op = "select";
    let payload: unknown;
    const query: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "order", "in"]) query[m] = () => query;
    let counting = false;
    query.select = (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head) counting = true;
      return query;
    };
    query.insert = (rows: unknown) => {
      op = "insert";
      payload = rows;
      calls.push({ table, op, payload });
      return query;
    };
    query.update = (row: unknown) => {
      op = "update";
      payload = row;
      calls.push({ table, op, payload });
      return query;
    };
    query.delete = () => {
      op = "delete";
      calls.push({ table, op });
      return query;
    };
    query.single = async () => ({ data: { id: "new-1" }, error: null });
    query.maybeSingle = async () => ({ data: table === "loans" ? loan : null, error: null });
    query.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(counting ? { count: repaymentCount, error: null } : { data: [], error: null }).then(onF, onR);
    return query;
  };
  return { client: { from, rpc }, calls, rpc };
}

function grant(client: unknown) {
  requireProfile.mockResolvedValue({ profile: { id: "prof-1", role: "admin" }, supabase: client });
}

const LOAN: LoanInput = {
  direction: "taken",
  lender: "ברנדווין",
  borrower: "",
  counterparty_customer_id: null,
  loan_date: "2026-10-22",
  loan_method: "cash",
  repayment_method: "",
  documentation: "",
  amount: 52400,
  due_date: "",
  interest_amount: 0,
  business_domain: "general_business",
  account_id: null,
  notes: "",
};

beforeEach(() => requireProfile.mockReset());

describe("loan actions — a loan in dollars", () => {
  it("createLoan: $52,400 is ₪162,806.80 at the day's 3.107; its plan in dollars at that rate", async () => {
    const { client, calls, rpc } = fakeSupabase();
    grant(client);
    const res = await createLoan({ ...LOAN, currency: "USD", fx_rate_manual: false }, [
      { repayment_date: "2026-11-22", amount: 26200, interest_amount: 0, notes: "" },
      { repayment_date: "2026-12-22", amount: 26200, interest_amount: 0, notes: "" },
    ]);
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("fx_rate_on", { p_currency: "USD", p_date: "2026-10-22" });
    expect(calls.find((c) => c.table === "loans" && c.op === "insert")?.payload).toMatchObject({
      amount: 162806.8,
      currency: "USD",
      foreign_amount: 52400,
      fx_rate: 3.107,
    });
    const plan = calls.find((c) => c.table === "loan_repayments" && c.op === "insert")?.payload as Array<Record<string, unknown>>;
    expect(plan[0]).toMatchObject({ amount: 81403.4, currency: "USD", foreign_amount: 26200, fx_rate: 3.107, status: "planned" });
  });

  it("a rate typed by hand for the loan", async () => {
    const { client, calls, rpc } = fakeSupabase();
    grant(client);
    await createLoan({ ...LOAN, currency: "USD", fx_rate: 3, fx_rate_manual: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === "loans" && c.op === "insert")?.payload).toMatchObject({ amount: 157200, fx_rate: 3, fx_rate_manual: true });
  });

  it("addRepayment: in the loan's dollars, at its own day's rate, interest too", async () => {
    const { client, calls, rpc } = fakeSupabase({ loan: { currency: "USD", fx_rate: 3 }, rate: 3.1 });
    grant(client);
    const res = await addRepayment("loan-1", {
      repayment_date: "2026-11-01",
      amount: 1000,
      interest_amount: 100,
      method: "cash",
      account_id: null,
      notes: "",
      fx_rate_manual: false,
    });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("fx_rate_on", { p_currency: "USD", p_date: "2026-11-01" });
    expect(calls.find((c) => c.table === "loan_repayments" && c.op === "insert")?.payload).toMatchObject({
      amount: 3100,
      interest_amount: 310,
      currency: "USD",
      foreign_amount: 1000,
      fx_rate: 3.1,
    });
  });

  it("a loan in shekels: its repayment in shekels, as before", async () => {
    const { client, calls, rpc } = fakeSupabase({ loan: { currency: "ILS", fx_rate: null } });
    grant(client);
    await addRepayment("loan-1", { repayment_date: "2026-11-01", amount: 500, interest_amount: 0, method: "", account_id: null, notes: "" });
    expect(rpc).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === "loan_repayments" && c.op === "insert")?.payload).toMatchObject({ amount: 500, currency: "ILS", foreign_amount: null });
  });

  it("updateLoan: its currency can't change once it has repayments", async () => {
    const { client } = fakeSupabase({ loan: { currency: "ILS", fx_rate: null }, repaymentCount: 2 });
    grant(client);
    const res = await updateLoan("loan-1", { ...LOAN, currency: "USD" });
    expect(res).toEqual({ ok: false, error: "אי אפשר לשנות את המטבע של הלוואה שיש לה כבר החזרים." });
  });
});
