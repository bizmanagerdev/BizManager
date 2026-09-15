import { describe, it, expect } from "vitest";
import { loadOutflowSources } from "@/lib/outflow-sources";

// The rows of "תשלומים קבועים" that come from OTHER owners — payroll, the loan
// plans, the card statements — merged with their stored settings. Read through
// a fake Supabase whose every chain resolves to the table's canned rows.

type Row = Record<string, unknown>;

function makeSupabase(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const resp = { data: tables[table] ?? [], error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "not", "lt", "lte", "gt", "gte", "in", "is", "order", "range", "limit"]) {
      builder[m] = () => builder;
    }
    builder.then = (onF: (v: typeof resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from } as never;
}

const TODAY = "2026-09-15";

const tables: Record<string, Row[]> = {
  salary_agreements: [
    { id: "a1", user_id: "u1", salary_type: "monthly", monthly_salary: 8000, valid_from: "2026-01-01", valid_to: null, due_day_of_next_month: 20 },
    { id: "a2", user_id: "u2", salary_type: "hourly", monthly_salary: null, valid_from: "2026-04-01", valid_to: null, due_day_of_next_month: 10 },
    { id: "a3", user_id: "u3", salary_type: "monthly", monthly_salary: 5000, valid_from: "2025-01-01", valid_to: "2026-06-30", due_day_of_next_month: 10 },
    { id: "a4", user_id: "u4", salary_type: "monthly", monthly_salary: 7000, valid_from: "2026-01-01", valid_to: null, due_day_of_next_month: 10 },
  ],
  users: [
    { id: "u1", full_name: "דוד", email: null, active: true },
    { id: "u2", full_name: "נתן", email: null, active: true },
    { id: "u3", full_name: "ישן", email: null, active: true },
    { id: "u4", full_name: "עזב", email: null, active: false },
  ],
  worker_payments: [{ user_id: "u1", payment_date: "2026-09-05" }],
  loans: [
    { id: "L1", direction: "taken", lender: "ברנדווין", borrower: null, loan_date: "2026-01-01", loan_method: null, repayment_method: null, documentation: null, amount: 157200, due_date: null, interest_amount: 0, business_domain: "general_business", counterparty_customer_id: null, status: "active", notes: null, account_id: "acc-l", created_at: null },
    { id: "L2", direction: "taken", lender: "רוזנפלד", borrower: null, loan_date: "2026-08-01", loan_method: null, repayment_method: null, documentation: null, amount: 15000, due_date: null, interest_amount: 0, business_domain: "general_business", counterparty_customer_id: null, status: "active", notes: null, account_id: null, created_at: null },
    { id: "L3", direction: "given", lender: null, borrower: "לקוח", loan_date: "2026-01-01", loan_method: null, repayment_method: null, documentation: null, amount: 3000, due_date: null, interest_amount: 0, business_domain: "general_business", counterparty_customer_id: null, status: "active", notes: null, account_id: null, created_at: null },
    { id: "L4", direction: "taken", lender: "סגור", borrower: null, loan_date: "2025-01-01", loan_method: null, repayment_method: null, documentation: null, amount: 1000, due_date: null, interest_amount: 0, business_domain: "general_business", counterparty_customer_id: null, status: "repaid", notes: null, account_id: null, created_at: null },
  ],
  loan_repayments: [
    { id: "r1", loan_id: "L1", repayment_date: "2026-10-01", amount: 157200, interest_amount: 0, method: null, account_id: null, notes: null, created_at: null, status: "planned", installment_index: 1, installment_count: 1 },
    { id: "r2", loan_id: "L2", repayment_date: "2026-09-18", amount: 5000, interest_amount: 0, method: null, account_id: null, notes: null, created_at: null, status: "planned", installment_index: 1, installment_count: 3 },
    { id: "r3", loan_id: "L2", repayment_date: "2026-10-18", amount: 5000, interest_amount: 0, method: null, account_id: null, notes: null, created_at: null, status: "planned", installment_index: 2, installment_count: 3 },
    { id: "r4", loan_id: "L2", repayment_date: "2026-11-18", amount: 5000, interest_amount: 0, method: null, account_id: null, notes: null, created_at: null, status: "planned", installment_index: 3, installment_count: 3 },
    { id: "r5", loan_id: "L3", repayment_date: "2026-10-01", amount: 3000, interest_amount: 0, method: null, account_id: null, notes: null, created_at: null, status: "planned", installment_index: null, installment_count: null },
    { id: "r6", loan_id: "L4", repayment_date: "2025-06-01", amount: 1000, interest_amount: 0, method: null, account_id: null, notes: null, created_at: null, status: "paid", installment_index: null, installment_count: null },
  ],
  card_statement_charges: [
    { id: "c1", card_label: "ויזה", account_id: "acc-c", amount: 1000, charge_date: "2026-08-05" },
    { id: "c0", card_label: "ויזה", account_id: "acc-c", amount: 900, charge_date: "2026-07-05" },
    { id: "c2", card_label: "מאסטר", account_id: null, amount: 2500, charge_date: "2026-10-02" },
  ],
  outflow_source_settings: [
    { source_kind: "salary", source_key: "u1", reminder_work_days_before: 2, account_id: null, is_active: false },
    // An explicit "no account" — must not fall back to the loan's own account.
    { source_kind: "loan", source_key: "L1", reminder_work_days_before: null, account_id: null, is_active: true },
  ],
};

describe("loadOutflowSources", () => {
  it("salaries: every worker with an agreement in force — monthly with its amount, hourly as משתנה; expired agreements and inactive users are skipped", async () => {
    const rows = await loadOutflowSources(makeSupabase(tables), { todayIso: TODAY });
    const salaries = rows.filter((r) => r.kind === "salary");
    expect(salaries.map((r) => r.key).sort()).toEqual(["u1", "u2"]);
    const u1 = salaries.find((r) => r.key === "u1")!;
    expect(u1).toMatchObject({
      name: "משכורת דוד",
      scheduleLabel: "20 לכל חודש",
      nextDate: "2026-09-20",
      focusId: "salary_proj:u1:2026-09",
      amount: 8000,
      monthly: true,
      settled: true, // a wage payment dated 05/09 covers September
      effectiveReminderDays: 2,
      isActive: false,
    });
    const u2 = salaries.find((r) => r.key === "u2")!;
    expect(u2).toMatchObject({
      name: "משכורת נתן",
      scheduleLabel: "10 לכל חודש · לפי שעות",
      nextDate: "2026-10-10",
      amount: null,
      monthly: false,
      settled: false,
      effectiveReminderDays: 0,
      isActive: true,
    });
  });

  it("loans: only loans the business repays and hasn't finished; a bullet repayment is one-off, an instalment plan is monthly", async () => {
    const rows = await loadOutflowSources(makeSupabase(tables), { todayIso: TODAY });
    const loans = rows.filter((r) => r.kind === "loan");
    expect(loans.map((r) => r.key).sort()).toEqual(["L1", "L2"]);
    expect(loans.find((r) => r.key === "L1")).toMatchObject({
      name: "החזר הלוואה — ברנדווין",
      scheduleLabel: "תשלום חד-פעמי",
      nextDate: "2026-10-01",
      focusId: "loan_planned:r1",
      amount: 157200,
      monthly: false,
      accountId: null, // explicit empty setting wins over acc-l
      href: "/financial/loans/L1",
    });
    expect(loans.find((r) => r.key === "L2")).toMatchObject({
      scheduleLabel: "תשלום 1 מתוך 3 · חודשי",
      nextDate: "2026-09-18",
      focusId: "loan_planned:r2",
      amount: 5000,
      monthly: true,
    });
  });

  it("cards: one row per card on its usual day with no amount, unless a real charge is already recorded for a future date", async () => {
    const rows = await loadOutflowSources(makeSupabase(tables), { todayIso: TODAY });
    const cards = rows.filter((r) => r.kind === "card");
    expect(cards.map((r) => r.key).sort()).toEqual(["מאסטר", "ויזה"].sort());
    expect(cards.find((r) => r.key === "ויזה")).toMatchObject({
      name: "חיוב כרטיס: ויזה",
      scheduleLabel: "5 לכל חודש · לפי הדף האחרון",
      nextDate: "2026-10-05",
      focusId: "ccharge_proj:ויזה:2026-10",
      amount: null,
      accountId: "acc-c",
      effectiveReminderDays: 3,
      monthly: false,
    });
    expect(cards.find((r) => r.key === "מאסטר")).toMatchObject({
      nextDate: "2026-10-02",
      focusId: "ccharge:c2",
      amount: 2500,
    });
  });

  it("is empty, not broken, when a source's table can't be read (the tab's mode)", async () => {
    const broken = {
      from: (table: string) => {
        const resp = table === "salary_agreements" ? { data: null, error: { message: "permission denied" } } : { data: tables[table] ?? [], error: null };
        const builder: Record<string, unknown> = {};
        for (const m of ["select", "eq", "gte", "in", "order", "range"]) builder[m] = () => builder;
        builder.then = (onF: (v: typeof resp) => unknown) => Promise.resolve(resp).then(onF);
        return builder;
      },
    } as never;
    const rows = await loadOutflowSources(broken, { todayIso: TODAY });
    expect(rows.some((r) => r.kind === "salary")).toBe(false);
    expect(rows.some((r) => r.kind === "card")).toBe(true);
    await expect(loadOutflowSources(broken, { todayIso: TODAY, throwOnError: true })).rejects.toThrow(/salary_agreements/);
  });
});
