import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { AppSchema } from "@/lib/powersync/schema";
import { createLocalSupabase } from "@/lib/powersync/local-supabase";
import { computeLocalCard } from "@/lib/powersync/dashboard-local";
import { goneIsDone, isCarriedChange, requestForChange, type DeviceSaveRequest } from "@/lib/powersync/local-writes";

// The accounts page saved on the device copy first (owner, 2026-10-27): the
// quick line's expenses and income, the "נבדק מול הבנק" ticks and the register
// deletes go into the copy — the page, worked out from it, shows them at once
// — and each goes up to the route the page used before, carried by the row's
// `_extras`. Run here on a real SQLite copy built from the app's device schema,
// with the change queue PowerSync keeps (a PUT / PATCH / DELETE per row
// written), fed to the connector's own reading of it.

type Row = Record<string, unknown>;
type Op = { table: string; op: string; id: string; opData?: Row };

const h = vi.hoisted(() => ({ ready: null as unknown }));
vi.mock("@/lib/powersync/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/powersync/store")>()),
  readyDeviceSaves: () => h.ready,
}));

import { deviceBankSaves } from "@/lib/financial/device-bank-saves";

/** A device copy: the schema's tables (PowerSync's column types: numbers kept as text), and its change queue. */
function deviceCopy() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE ps_crud (seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT, tbl TEXT, row_id TEXT, data TEXT)");
  for (const table of AppSchema.tables) {
    const columns = table.columns.map((column) => `"${column.name}" ${column.type}`);
    sqlite.exec(`CREATE TABLE ${table.name} (id TEXT PRIMARY KEY, ${columns.join(", ")})`);
    const json = `json_object(${table.columns.map((column) => `'${column.name}', NEW."${column.name}"`).join(", ")})`;
    sqlite.exec(
      `CREATE TRIGGER ${table.name}_put AFTER INSERT ON ${table.name} BEGIN INSERT INTO ps_crud (op, tbl, row_id, data) VALUES ('PUT', '${table.name}', NEW.id, ${json}); END`
    );
    sqlite.exec(
      `CREATE TRIGGER ${table.name}_patch AFTER UPDATE ON ${table.name} BEGIN INSERT INTO ps_crud (op, tbl, row_id, data) VALUES ('PATCH', '${table.name}', NEW.id, ${json}); END`
    );
    sqlite.exec(
      `CREATE TRIGGER ${table.name}_delete AFTER DELETE ON ${table.name} BEGIN INSERT INTO ps_crud (op, tbl, row_id, data) VALUES ('DELETE', '${table.name}', OLD.id, NULL); END`
    );
  }
  const bind = (params: unknown[] = []) => params.map((value) => (value === undefined ? null : value)) as never[];
  const db = {
    async execute(sql: string, params?: unknown[]) {
      sqlite.prepare(sql).run(...bind(params));
      return {};
    },
    async getOptional<T>(sql: string, params?: unknown[]) {
      return (sqlite.prepare(sql).get(...bind(params)) as T | undefined) ?? null;
    },
    async getAll<T>(sql: string, params?: unknown[]) {
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    async writeTransaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      sqlite.exec("BEGIN");
      try {
        const result = await callback(db);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const seed = (tables: Record<string, Row[]>) => {
    for (const [table, rows] of Object.entries(tables)) {
      for (const row of rows) {
        const columns = Object.keys(row);
        sqlite
          .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
          .run(...bind(Object.values(row)));
      }
    }
    sqlite.exec("DELETE FROM ps_crud");
  };
  const queue = (): Op[] =>
    (sqlite.prepare("SELECT op, tbl, row_id, data FROM ps_crud ORDER BY seq").all() as Row[]).map((row) => ({
      table: String(row.tbl),
      op: String(row.op),
      id: String(row.row_id),
      ...(row.data ? { opData: JSON.parse(String(row.data)) as Row } : {}),
    }));
  /** What the connector sends for the queue, in order (what goes inside another change is skipped). */
  const sent = async (): Promise<DeviceSaveRequest[]> => {
    const requests: DeviceSaveRequest[] = [];
    for (const op of queue()) {
      if (isCarriedChange(op as never)) continue;
      const request = await requestForChange(op as never, async () => null);
      if (!request) throw new Error(`nothing sends ${op.op} ${op.table}`);
      requests.push(request);
    }
    return requests;
  };
  const page = () => computeLocalCard(createLocalSupabase({ getAll: db.getAll }), "bankPage", viewer);
  return { db, seed, queue, sent, page, count: (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n };
}

const viewer = { userId: "admin", role: "admin", locale: "he" as const };

/** An admin's copy on 2026-10-27: the bank, the cash box (50) and a US$ account. */
const COPY: Record<string, Row[]> = {
  business_settings: [{ id: "true", vat_rate: "0.18", money_tables: 1, bank_tables: 1 }],
  users: [{ id: "admin", full_name: "מנהל", role: "admin", active: 1, system_access: 1, auth_user_id: "auth-admin" }],
  accounts: [
    { id: "a1", name: "מזרחי עסקי", kind: "bank", currency: "ILS", opening_balance: "1000", opening_date: "2026-07-01", is_active: 1, sort_order: 1 },
    { id: "a2", name: "מזומן", kind: "cash", currency: "ILS", opening_balance: "0", opening_date: "2026-07-01", is_active: 1, sort_order: 2 },
    { id: "a3", name: "Chase", kind: "bank", currency: "USD", opening_balance: "0", opening_date: "2026-10-01", is_active: 1, sort_order: 3 },
  ],
  customers: [{ id: "c1", name: "משה כהן", active: 1 }],
  projects: [{ id: "p1", name: "הובלה", customer_id: "c1", status: "active", project_type: "logistics", created_at: "2026-09-25 08:00:00.000Z" }],
  payments: [
    { id: "pay1", account_id: "a1", amount_total: "500", payment_status: "cleared", payment_date: "2026-10-01 00:00:00.000Z", payment_method: "bank_transfer", business_domain: "sales", created_at: "2026-10-01 09:00:00.000Z", recorded_by: "admin" },
  ],
  expenses: [
    { id: "e1", account_id: "a2", amount: "200", payment_status: "paid", expense_date: "2026-10-05 00:00:00.000Z", category: "משאית", project_id: "p1", business_domain: "logistics_projects", payment_method: "cash", created_at: "2026-10-05 09:00:00.000Z", recorded_by: "admin" },
  ],
  project_expenses: [{ id: "pe1", expense_id: "e1", project_id: "p1", included_in_base_price: 1, billed_to_customer: 0 }],
  account_transfers: [
    { id: "tr1", from_account_id: "a1", to_account_id: "a2", amount: "300", transfer_date: "2026-10-10", created_at: "2026-10-10 09:00:00.000Z" },
  ],
  loans: [
    { id: "l1", account_id: "a1", direction: "taken", loan_date: "2026-10-02", amount: "1000", lender: "אבא", created_at: "2026-10-02 09:00:00.000Z" },
  ],
  loan_repayments: [
    { id: "r1", loan_id: "l1", account_id: "a1", repayment_date: "2026-10-12", amount: "100", interest_amount: "0", created_at: "2026-10-12 09:00:00.000Z" },
    { id: "r2", loan_id: "l1", account_id: "a1", repayment_date: "2026-10-20", amount: "100", interest_amount: "0", created_at: "2026-10-20 09:00:00.000Z" },
  ],
  worker_payments: [
    { id: "w1", user_id: "admin", account_id: "a2", payment_date: "2026-10-15", amount: "50", payment_method: "cash", created_at: "2026-10-15 09:00:00.000Z" },
  ],
  account_ledger_checks: [{ id: "chk1", account_id: "a1", entry_key: "p:pay1", amount_at_check: "500", date_at_check: "2026-10-01" }],
  fx_rates: [{ id: "fx1", currency: "USD", rate_date: "2026-10-27", rate: "3.25" }],
};

const balance = async (copy: ReturnType<typeof deviceCopy>, accountId: string) =>
  (await copy.page()).accounts.find((account) => account.id === accountId)!.currentBalance;

describe("the accounts page saved on the device copy", () => {
  let copy: ReturnType<typeof deviceCopy>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T09:00:00Z"));
    copy = deviceCopy();
    copy.seed(COPY);
    h.ready = { db: copy.db, viewerId: "admin" };
  });
  afterEach(() => {
    vi.useRealTimers();
    h.ready = null;
  });

  it("the quick line's expense: on the page at once, and up to the expense route with its own id", async () => {
    // 0 − 200 (an expense) + 300 (from the bank) − 50 (a worker's pay).
    expect(await balance(copy, "a2")).toBe(50);
    const saves = deviceBankSaves()!;
    const body = {
      expense_date: "2026-10-27",
      amount: 80,
      category: "דלק",
      description: "תדלוק",
      business_domain: "general_business",
      project_id: null,
      property_id: null,
      payment_status: "paid",
      payment_method: "cash",
      account_id: "a2",
      currency: "ILS",
    };
    const id = await saves.addExpense(body, 1);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const page = await copy.page();
    const cash = page.accounts.find((account) => account.id === "a2")!;
    expect(cash.currentBalance).toBe(-30);
    expect(cash.ledger.find((row) => row.id === `e:${id}`)).toMatchObject({ amount: 80, label: expect.any(String) });

    expect(await copy.sent()).toEqual([{ kind: "expense-create", url: "/api/expenses/create", body: { ...body, id } }]);
  });

  it("a project's expense: its project link is written with it, and goes up inside the expense", async () => {
    const id = await deviceBankSaves()!.addExpense(
      {
        expense_date: "2026-10-27",
        amount: 120,
        category: "משאית",
        business_domain: "logistics_projects",
        project_id: "p1",
        payment_status: "paid",
        payment_method: "cash",
        account_id: "a2",
      },
      1
    );
    expect(copy.queue().map((op) => [op.op, op.table])).toEqual([
      ["PUT", "expenses"],
      ["PUT", "project_expenses"],
    ]);
    expect((await copy.sent()).map((request) => request.kind)).toEqual(["expense-create"]);
    expect(await copy.db.getOptional("SELECT project_id, billed_to_customer FROM project_expenses WHERE expense_id = ?", [id])).toEqual({
      project_id: "p1",
      billed_to_customer: 0,
    });
  });

  it("an expense the server would refuse isn't saved; one linked to what the phone doesn't have goes to the server", async () => {
    const saves = deviceBankSaves()!;
    const base = { expense_date: "2026-10-27", amount: 10, category: "משאית", payment_status: "paid", account_id: "a2" };
    await expect(saves.addExpense({ ...base, business_domain: "logistics_projects" }, 1)).rejects.toThrow("יש לבחור פרויקט לתחום פרויקטים.");
    expect(await saves.addExpense({ ...base, business_domain: "logistics_projects", project_id: "p-elsewhere" }, 1)).toBeNull();
    expect(copy.queue()).toEqual([]);
  });

  it("income in dollars on the Chase account: its shekels at the line's rate, the dollars beside them", async () => {
    const body = {
      payment_date: "2026-10-27",
      amount_total: 100,
      business_domain: "general_business",
      payment_method: "bank_transfer",
      account_id: "a3",
      currency: "USD",
      fx_rate_manual: false,
    };
    const id = await deviceBankSaves()!.addIncome(body, 3.25);
    const row = (await copy.db.getOptional<Row>("SELECT amount_total, foreign_amount, fx_rate, currency FROM payments WHERE id = ?", [id]))!;
    expect([Number(row.amount_total), Number(row.foreign_amount), Number(row.fx_rate), row.currency]).toEqual([325, 100, 3.25, "USD"]);
    expect(await balance(copy, "a3")).toBe(100);
    expect(await copy.sent()).toEqual([{ kind: "income-create", url: "/api/payments/create", body: { ...body, id } }]);
  });

  it("a tick and an untick: the page follows, and both go up in order", async () => {
    const saves = deviceBankSaves()!;
    const tickedRow = async (key: string) =>
      (await copy.page()).accounts.find((account) => account.id === "a1")!.ledger.find((row) => row.id === key)!.bankChecked;

    await saves.setCheck({ accountId: "a1", entryKey: "t:tr1:out", amount: -300, date: "2026-10-10", checked: true });
    expect(await tickedRow("t:tr1:out")).toBe(true);
    await saves.setCheck({ accountId: "a1", entryKey: "p:pay1", amount: 500, date: "2026-10-01", checked: false });
    expect(await tickedRow("p:pay1")).toBe(false);
    await saves.setCheck({ accountId: "a1", entryKey: "t:tr1:out", amount: -300, date: "2026-10-10", checked: false });
    expect(copy.count("account_ledger_checks")).toBe(0);

    expect((await copy.sent()).map((request) => [request.url, request.body.entry_key, request.body.checked])).toEqual([
      ["/api/accounts/ledger-checks", "t:tr1:out", true],
      ["/api/accounts/ledger-checks", "p:pay1", false],
      ["/api/accounts/ledger-checks", "t:tr1:out", false],
    ]);
  });

  it("every kind of register row deleted: gone from the page, and up to its own route — once", async () => {
    const saves = deviceBankSaves()!;
    expect(await saves.deleteRow({ kind: "transfer", id: "tr1" })).toBe(true);
    expect(await saves.deleteRow({ kind: "loan", id: "l1" })).toBe(true);
    expect(await saves.deleteRow({ kind: "worker_payment", id: "w1", userId: "admin" })).toBe(true);
    expect(await saves.deleteRow({ kind: "expense", id: "e1", projectId: "p1", orderId: null, propertyId: null })).toBe(true);
    expect(await saves.deleteRow({ kind: "payment", id: "pay1", projectId: null, orderId: null })).toBe(true);
    // Not on the phone: deleted on the server instead.
    expect(await saves.deleteRow({ kind: "card_charge", id: "cc-elsewhere" })).toBe(false);

    // What the server deletes with them is gone here too.
    expect(copy.count("loan_repayments")).toBe(0);
    expect(copy.count("project_expenses")).toBe(0);
    expect(await balance(copy, "a1")).toBe(1000);
    expect(await balance(copy, "a2")).toBe(0);

    expect((await copy.sent()).map(({ kind, url, method, body }) => [kind, url, method ?? "POST", body])).toEqual([
      ["transfer-delete", "/api/accounts/register-delete", "POST", { kind: "transfer", id: "tr1" }],
      ["loan-delete", "/api/accounts/register-delete", "POST", { kind: "loan", id: "l1" }],
      ["worker-payment-delete", "/api/payroll/worker-payments", "DELETE", { payment_id: "w1", user_id: "admin" }],
      ["expense-delete", "/api/expenses/delete", "POST", { id: "e1", project_id: "p1" }],
      ["payment-delete", "/api/payments/delete", "POST", { id: "pay1" }],
    ]);
  });

  it("deleting a row that's already gone on the server counts as done", () => {
    expect(goneIsDone("expense-delete")).toBe(true);
    expect(goneIsDone("transfer-delete")).toBe(true);
    expect(goneIsDone("task-delete")).toBe(true);
    expect(goneIsDone("expense-create")).toBe(false);
    expect(goneIsDone("task-comment-delete")).toBe(false);
  });

  it("no device copy ready (or not drawn from it): nothing to save on", () => {
    h.ready = null;
    expect(deviceBankSaves()).toBeNull();
  });
});
