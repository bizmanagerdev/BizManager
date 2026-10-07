import { describe, it, expect, vi } from "vitest";

// A project's page in two parts: what it shows of the project itself — read
// the same way wherever it's read (lib/projects/project-page.ts) — and what
// only the server reads, sent after the page (loadProjectPageExtras.ts): the
// documents and every row's files (signed in ONE call), Morning documents,
// "entered by" from the change log, and the admin-only history.

vi.mock("@/lib/settings/vat", () => ({ getCurrentVatRate: async () => 0.18 }));
vi.mock("@/lib/projects/owed", () => ({
  emptyProjectOwed: () => ({ total: 0 }),
  loadProjectOwed: async () => new Map([["p1", { total: 50 }]]),
}));
const audit = vi.hoisted(() => ({
  latest: vi.fn(async (_sb: unknown, { recordIds }: { tableName: string; recordIds: string[] }) => ({
    byRecordId: Object.fromEntries(recordIds.map((id) => [id, { action: "create", actorName: "דנה" }])),
    error: null,
  })),
  trail: vi.fn(async () => ({ items: [{ id: "h1" }], error: null })),
  names: vi.fn(async (_sb: unknown, values: string[]) => Object.fromEntries(values.map((v) => [v, `שם ${v}`]))),
}));
vi.mock("@/lib/audit", () => ({
  getLatestAuditByRecordIds: audit.latest,
  getEntityAuditTrail: audit.trail,
  resolveUserDisplayNamesForValues: audit.names,
}));

import { startProjectPageReads } from "@/lib/projects/project-page";
import { loadProjectPageExtras } from "@/app/(app)/projects/[id]/loadProjectPageExtras";

type Call = { method: string; args: unknown[] };
type Answer = { data: unknown; error: { message: string; code?: string } | null };

/** A Supabase stand-in: each query's answer is chosen from its table and the calls made on it. */
function fakeSupabase(answer: (table: string, calls: Call[]) => Answer) {
  const signed: string[][] = [];
  const from = (table: string) => {
    const calls: Call[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "range", "neq", "is"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.maybeSingle = () => {
      const { data, error } = answer(table, calls);
      return Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error });
    };
    builder.then = (ok: (v: Answer) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(answer(table, calls)).then(ok, fail);
    return builder;
  };
  const storage = {
    from: () => ({
      createSignedUrls: async (keys: string[]) => {
        signed.push(keys);
        return { data: keys.map((path) => ({ path, signedUrl: `https://signed/${path}` })), error: null };
      },
    }),
  };
  return { supabase: { from, storage } as never, signed };
}

const has = (calls: Call[], method: string, column?: string) =>
  calls.some((c) => c.method === method && (column === undefined || c.args[0] === column));

const ok = (data: unknown): Answer => ({ data, error: null });

function projectData(table: string, calls: Call[]): Answer {
  switch (table) {
    case "project_dashboard_view":
      return ok({ id: "p1", name: "הובלה", customer_id: "c1", total_tasks: 2 });
    case "projects":
      return ok({ id: "p1", notes: "שקט", branch_id: "b1" });
    case "project_worker_balance_view":
      return ok({ project_id: "p1", owed_amount: 10 });
    case "task_overview_view":
      return ok([{ task_id: "t1" }]);
    case "users":
      if (has(calls, "in", "id")) return ok([{ id: "u1", auth_user_id: "auth1", full_name: " משה ", email: "m@x" }]);
      if (has(calls, "in", "auth_user_id")) return ok([]);
      return ok([{ id: "u1", full_name: "משה", active: true }]);
    case "customers":
      return has(calls, "eq", "id") ? ok({ phone: "050", email: null, address: "חיפה", name_for_invoice: null }) : ok([{ id: "c1", name: "דני" }]);
    case "customer_branches":
      return ok({ id: "b1", name: "צפון", address: null, phone: "04" });
    case "project_expenses":
      return ok([{ id: "pe1", expense_id: "e1" }]);
    case "expenses":
      return ok([{ id: "e1", recorded_by: "auth1", recurring_expense_template_id: "tpl1", expense_date: "2026-10-01" }]);
    case "recurring_expense_templates":
      return ok([{ id: "tpl1", template_name: " שכירות ", created_by: "u9" }]);
    case "attendance_sessions":
      return ok([{ id: "s1", clock_in: "2026-10-02T06:00:00Z" }]);
    case "session_effective_payment_view":
      return { data: null, error: { message: "relation does not exist" } };
    case "worker_debt_items_view":
      return has(calls, "eq", "source_type") && calls.some((c) => c.args[1] === "session")
        ? ok([{ source_id: "s1", paid_amount: 5, owed_amount: 0, payment_status: "paid" }])
        : ok([{ source_id: "ps1", user_id: "u1", period_month: "2026-09-01", earned_amount: "900" }]);
    case "worker_payment_allocations":
      return has(calls, "in", "payslip_id")
        ? ok([{ payslip_id: "ps1", worker_payments: { account_id: "a1" } }])
        : ok([{ attendance_session_id: "s1", worker_payments: [{ account_id: "a2" }] }]);
    case "payments":
      return ok([{ id: "pay1", recorded_by: "u1", amount_total: 100 }]);
    case "salary_agreements":
      return ok([{ id: "sa1", user_id: "u1" }]);
    case "accounts":
      return ok([{ id: "a1", name: " בנק " }, { id: "a2", name: "  " }]);
    default:
      throw new Error(`unexpected table ${table}`);
  }
}

describe("a project's page: the project itself", () => {
  it("reads it all and puts it together the way the page shows it", async () => {
    const { supabase } = fakeSupabase(projectData);
    const reads = startProjectPageReads(supabase, "p1");
    expect(await reads.expenseIds).toEqual(["e1"]);
    expect(await reads.sessionIds).toEqual(["s1"]);
    expect(await reads.paymentIds).toEqual(["pay1"]);

    const core = await reads.core;
    expect(core.filters).toEqual({ id: "p1" });
    expect(core.currentVatRate).toBe(0.18);
    expect(core.dashboardRow).toMatchObject({ name: "הובלה" });
    expect(core.details).toMatchObject({ notes: "שקט" });
    expect(core.expenses.map((e) => e.id)).toEqual(["e1"]);
    // Who entered it — by id or by login id.
    expect(core.expenseRecordedByNameByValue).toEqual({ u1: "משה", auth1: "משה" });
    expect(core.paymentRecordedByNameByValue).toEqual({ u1: "משה", auth1: "משה" });
    expect(core.recurringTemplateNames).toEqual({ tpl1: "שכירות" });
    expect(core.recurringTemplateAuthors).toEqual({ tpl1: "u9" });
    // Without session_effective_payment_view: the raw session debt rows, keyed by session.
    expect(core.sessionDebtById.s1).toMatchObject({ session_id: "s1", payment_status: "paid" });
    expect(core.monthlySalaryItems).toEqual([
      expect.objectContaining({ payslip_id: "ps1", user_id: "u1", earned_amount: "900" }),
    ]);
    expect(core.wageAccountIdsBySource).toEqual({ "session:s1": ["a2"], "payslip:ps1": ["a1"] });
    expect(core.customerRow).toMatchObject({ phone: "050" });
    expect(core.branchRow).toMatchObject({ name: "צפון" });
    expect(core.accountNameById).toEqual({ a1: "בנק", a2: "חשבון" });
    expect(core.owed).toEqual({ total: 50 });
    expect(core.errors).toEqual({ overview: null, projectExpenses: null, expenses: null, sessions: null, payments: null });
  });
});

describe("a project's page: what only the server reads", () => {
  const links = (entity: string, ids: string[]) =>
    ids.map((id) => ({ entity_type: entity, entity_id: id, document_id: `d-${id}`, created_at: "2026-10-01", document: { id: `d-${id}`, storage_key: `k-${id}`, file_name: `${id}.jpg`, uploaded_by: "u1" } }));

  function serverData(table: string, calls: Call[]): Answer {
    if (table === "document_links") {
      const entity = calls.find((c) => c.method === "eq" && c.args[0] === "entity_type")?.args[1] as string;
      if (entity === "project") return ok(links("project", ["p1"]));
      const ids = (calls.find((c) => c.method === "in")?.args[1] ?? []) as string[];
      return ok(links(entity, ids));
    }
    if (table === "morning_documents") {
      return has(calls, "eq", "project_id") ? ok([{ id: "m1", project_id: "p1" }]) : ok([{ id: "m2", payment_id: "pay1" }, { id: "m1" }]);
    }
    throw new Error(`unexpected table ${table}`);
  }

  it("documents and every row's files (signed in one call), Morning documents, change-log entries, history for admins", async () => {
    const { supabase, signed } = fakeSupabase(serverData);
    const extras = await loadProjectPageExtras(supabase, {
      id: "p1",
      expenseIds: Promise.resolve(["e1"]),
      sessionIds: Promise.resolve(["s1"]),
      paymentIds: Promise.resolve(["pay1"]),
      withActivity: Promise.resolve(true),
    });
    expect(signed).toEqual([["k-p1", "k-e1", "k-s1", "k-pay1"]]);
    expect(extras.projectDocuments).toEqual([
      expect.objectContaining({ document_id: "d-p1", url: "https://signed/k-p1", uploaded_by_name: "שם u1" }),
    ]);
    expect(extras.attachments.expense.e1).toEqual([expect.objectContaining({ document_id: "d-e1", url: "https://signed/k-e1" })]);
    expect(extras.attachments.session.s1[0].file_name).toBe("s1.jpg");
    expect(extras.attachments.payment.pay1[0].url).toBe("https://signed/k-pay1");
    expect(extras.morningDocuments.map((d) => d.id)).toEqual(["m1", "m2"]);
    expect(Object.keys(extras.expenseAudit)).toEqual(["e1"]);
    expect(Object.keys(extras.paymentAudit)).toEqual(["pay1"]);
    expect(extras.activity).toEqual([{ id: "h1" }]);
  });

  it("no history for anyone else; and a failure is reported on the page, never thrown", async () => {
    const { supabase } = fakeSupabase(serverData);
    const none = await loadProjectPageExtras(supabase, {
      id: "p1",
      expenseIds: Promise.resolve([]),
      sessionIds: Promise.resolve([]),
      paymentIds: Promise.resolve([]),
      withActivity: Promise.resolve(false),
    });
    expect(none.activity).toBeNull();

    const broken = fakeSupabase(() => {
      throw new Error("network down");
    });
    const failed = await loadProjectPageExtras(broken.supabase, {
      id: "p1",
      expenseIds: Promise.resolve([]),
      sessionIds: Promise.resolve([]),
      paymentIds: Promise.resolve([]),
      withActivity: Promise.resolve(false),
    });
    expect(failed.projectDocumentsError).toBe("network down");
    expect(failed.projectDocuments).toEqual([]);
  });
});
