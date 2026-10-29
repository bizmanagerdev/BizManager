import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// A worker can't see the business's money (audit 2026-10-27). Unlike
// rls-policies.test.ts (a check of the migrations' text), this signs in as each
// person against a real database and reads through its access rules, as the
// app does: a row is added to every money table, and each person asks for it.
//
// CI runs it on a database of its own, built from the migrations (the "worker
// money access" job in .github/workflows/ci.yml); everywhere else it's skipped.
// It needs RLS_TEST_URL, RLS_TEST_ANON_KEY and RLS_TEST_SERVICE_KEY, and refuses
// any address but this machine's: it adds rows as the service role, so it must
// never reach the live database. The logins are supabase/seed.sql's.

const env = process.env;
const READY = Boolean(env.RLS_TEST_URL && env.RLS_TEST_ANON_KEY && env.RLS_TEST_SERVICE_KEY);
if (READY && !["127.0.0.1", "localhost"].includes(new URL(env.RLS_TEST_URL!).hostname)) {
  throw new Error(`RLS_TEST_URL must be a database on this machine (the test adds rows), not ${env.RLS_TEST_URL}`);
}

const ADMIN = "00000000-0000-0000-0000-0000000e2e01";
const OFFICE = "00000000-0000-0000-0000-0000000e2e02";
const WORKER = "00000000-0000-0000-0000-0000000e2e03";
const PASSWORD = "e2e-test-password-123";
const DAY = "2026-01-15";

type Row = { table: string; row: Record<string, unknown> & { id: string }; workerSees: boolean };
const id = () => randomUUID();
/** A payment with no VAT split, as the app sends one (amount_including_vat defaults to 0, which the split rule refuses). */
const payment = (recordedBy: string) => ({
  id: id(), amount_total: 100, net_amount: 100, amount_including_vat: null, payment_method: "cash", payment_date: DAY,
  recorded_by: recordedBy, business_domain: "general_business",
});
const expense = (recordedBy: string, amount: number) => ({
  id: id(), amount, category: "fuel", business_domain: "general_business", recorded_by: recordedBy,
});
const hidden = (table: string, row: Row["row"]): Row => ({ table, row, workerSees: false });
const own = (table: string, row: Row["row"]): Row => ({ table, row, workerSees: true });

const ids = {
  customer: id(), property: id(), project: id(), account: id(), cash: id(), loan: id(),
  expense: id(), ownPeriod: id(), otherPeriod: id(), ownPayslip: id(),
};

/** What the money rows point at; not money, so not checked. */
const SETUP: Array<[string, Record<string, unknown>]> = [
  ["customers", { id: ids.customer, name: "CI customer", phone: "050-0000000", city: "CI" }],
  ["properties", { id: ids.property, address: "CI street 1" }],
  ["projects", { id: ids.project, customer_id: ids.customer, name: "CI project", project_type: "other", status: "active" }],
];

/** One row in every money table, in the order they can be added. */
const ROWS: Row[] = [
  hidden("accounts", { id: ids.account, name: "CI bank", opening_date: DAY }),
  hidden("accounts", { id: ids.cash, name: "CI cash", opening_date: DAY, kind: "cash" }),
  hidden("account_transfers", { id: id(), from_account_id: ids.account, to_account_id: ids.cash, amount: 10, transfer_date: DAY }),
  hidden("account_ledger_checks", { id: id(), account_id: ids.account, entry_key: "ci", amount_at_check: 10, date_at_check: DAY }),
  hidden("loans", { id: ids.loan, loan_date: DAY, amount: 1000 }),
  hidden("loan_repayments", { id: id(), loan_id: ids.loan, repayment_date: DAY, amount: 100 }),
  hidden("payment_promises", { id: id(), amount: 500, promised_date: DAY }),
  hidden("card_statements", { id: id() }),
  hidden("lease_agreements", { id: id(), property_id: ids.property, customer_id: ids.customer, start_date: DAY, monthly_rent_amount: 3000 }),
  hidden("payments", payment(ADMIN)),
  hidden("expenses", { ...expense(ADMIN, 50), id: ids.expense }),
  hidden("project_expenses", { id: id(), project_id: ids.project, expense_id: ids.expense }),
  hidden("recurring_expense_templates", { id: id(), template_name: "CI rent", category: "rent", amount: 100, business_domain: "general_business" }),
  // Someone else's pay: their pay period, payslip, salary and a payment to them.
  hidden("payroll_periods", { id: ids.otherPeriod, period_month: "2026-02", start_date: "2026-02-01", end_date: "2026-02-28", status: "open" }),
  hidden("payslips", {
    id: id(), payroll_period_id: ids.otherPeriod, user_id: OFFICE, calculated_salary_type: "monthly",
    total_work_minutes: 0, calculated_base_salary: 9000, gross_salary: 9000,
  }),
  hidden("salary_agreements", { id: id(), user_id: OFFICE, salary_type: "monthly", monthly_salary: 9000, valid_from: DAY }),
  hidden("worker_payments", { id: id(), user_id: OFFICE, payment_date: DAY, amount: 9000 }),
  // The worker's own, which they do see.
  own("payroll_periods", { id: ids.ownPeriod, period_month: "2026-01", start_date: "2026-01-01", end_date: "2026-01-31", status: "open" }),
  own("payslips", {
    id: ids.ownPayslip, payroll_period_id: ids.ownPeriod, user_id: WORKER, calculated_salary_type: "monthly",
    total_work_minutes: 0, calculated_base_salary: 8000, gross_salary: 8000,
  }),
  own("salary_agreements", { id: id(), user_id: WORKER, salary_type: "monthly", monthly_salary: 8000, valid_from: DAY }),
  own("worker_payments", { id: id(), user_id: WORKER, payment_date: DAY, amount: 8000 }),
  own("expenses", expense(WORKER, 30)),
];

/** Each table's ids among the rows, sorted. */
function byTable(rows: Row[]): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const { table, row } of rows) tables.set(table, [...(tables.get(table) ?? []), row.id].sort());
  return tables;
}

function connect(key: string): SupabaseClient {
  return createClient(env.RLS_TEST_URL!, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = connect(env.RLS_TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signing in as ${email}: ${error.message}`);
  return client;
}

/** Which of these rows the client gets back. Refused outright (no grant) is not seeing them either. */
async function visible(client: SupabaseClient, table: string, rowIds: string[]): Promise<string[]> {
  const { data, error } = await client.from(table).select("id").in("id", rowIds);
  if (error?.code === "42501") return [];
  if (error) throw new Error(`reading ${table}: ${error.message}`);
  return (data as Array<{ id: string }>).map((r) => r.id).sort();
}

async function exists(table: string, rowId: string): Promise<boolean> {
  const { data, error } = await service.from(table).select("id").eq("id", rowId);
  if (error) throw new Error(`reading ${table}: ${error.message}`);
  return data.length > 0;
}

let service: SupabaseClient;
let admin: SupabaseClient;
let worker: SupabaseClient;

describe.skipIf(!READY)("who can see the money (a real database)", () => {
  beforeAll(async () => {
    service = connect(env.RLS_TEST_SERVICE_KEY!);
    for (const [table, row] of [...SETUP, ...ROWS.map((r) => [r.table, r.row] as const)]) {
      const { error } = await service.from(table).insert(row);
      if (error) throw new Error(`adding a ${table} row: ${error.message}`);
    }
    admin = await signIn("e2e-admin@bizh.test");
    worker = await signIn("e2e-worker@bizh.test");
  }, 60_000);

  it("the admin sees every row (so the checks below can't pass by seeing nothing)", async () => {
    for (const [table, rowIds] of byTable(ROWS)) {
      expect(await visible(admin, table, rowIds), table).toEqual(rowIds);
    }
  });

  it("a worker sees none of the business's money, nor anyone else's pay", async () => {
    for (const [table, rowIds] of byTable(ROWS.filter((r) => !r.workerSees))) {
      expect(await visible(worker, table, rowIds), table).toEqual([]);
    }
  });

  it("a worker sees their own payslip, pay period, salary, payments to them and the expenses they recorded", async () => {
    for (const [table, rowIds] of byTable(ROWS.filter((r) => r.workerSees))) {
      expect(await visible(worker, table, rowIds), table).toEqual(rowIds);
    }
  });

  it("signed out, nothing at all", async () => {
    const anon = connect(env.RLS_TEST_ANON_KEY!);
    for (const [table, rowIds] of byTable(ROWS)) {
      expect(await visible(anon, table, rowIds), table).toEqual([]);
    }
  });

  // Each refused row is one the admin can add as it is, and the refusal is the
  // access rules' own (42501): it can't pass on a row the database would refuse anyway.
  it("a worker can't add a payment", async () => {
    expect((await admin.from("payments").insert(payment(ADMIN))).error).toBeNull();
    const row = payment(WORKER);
    const { error } = await worker.from("payments").insert(row);
    expect(error?.code).toBe("42501");
    expect(await exists("payments", row.id)).toBe(false);
  });

  it("a worker can't add an expense in someone else's name", async () => {
    expect((await admin.from("expenses").insert(expense(ADMIN, 20))).error).toBeNull();
    const row = expense(ADMIN, 20);
    const { error } = await worker.from("expenses").insert(row);
    expect(error?.code).toBe("42501");
    expect(await exists("expenses", row.id)).toBe(false);
  });

  it("a worker can't change their own payslip", async () => {
    await worker.from("payslips").update({ gross_salary: 99_999 }).eq("id", ids.ownPayslip);
    const { data } = await service.from("payslips").select("gross_salary").eq("id", ids.ownPayslip).single();
    expect(Number(data?.gross_salary)).toBe(8000);
  });
});
