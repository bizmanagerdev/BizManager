import { beforeEach, describe, expect, it, vi } from "vitest";

// The customer page's reads (loadCustomerPage.ts) against a stand-in database
// that answers like PostgREST: filters, `in` lists, ranges of at most 1000
// rows. What they must do since the owner's playbook (2026-10-13):
// - every read goes out at once — the light ones don't wait for the role check;
// - nothing is cut off at 1000 rows, and no id list goes out longer than 150;
// - every list is ordered with a tie-breaker, so the rows never reshuffle;
// - the payments are all of them (the page read the newest 60 order payments
//   and counted those).

const libs = vi.hoisted(() => ({
  getCustomerReceivables: vi.fn(async () => [] as unknown[]),
  getCustomerActivity: vi.fn(async () => ({ logs: [], reminders: [] })),
  getCustomerPromises: vi.fn(async () => [] as unknown[]),
  getEntityAuditTrail: vi.fn(async (..._args: unknown[]) => ({ items: [] as unknown[], error: null })),
  getCustomerLoanPositions: vi.fn(async () => ({ owedToUs: 0, owedByUs: 0, loans: [] })),
}));
vi.mock("@/lib/collections", () => ({ getCustomerReceivables: libs.getCustomerReceivables }));
vi.mock("@/lib/communications", () => ({ getCustomerActivity: libs.getCustomerActivity }));
vi.mock("@/lib/promises", () => ({ getCustomerPromises: libs.getCustomerPromises }));
vi.mock("@/lib/audit", () => ({ getEntityAuditTrail: libs.getEntityAuditTrail }));
vi.mock("@/lib/customers/counterpartyBalance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customers/counterpartyBalance")>()),
  getCustomerLoanPositions: libs.getCustomerLoanPositions,
}));

import { startCustomerPageReads } from "@/app/(app)/customers/[id]/loadCustomerPage";

type Row = Record<string, unknown>;
type Call = {
  table: string;
  eq: Array<[string, unknown]>;
  in: [string, string[]] | null;
  order: string[];
  range: [number, number] | null;
};

const PAGE = 1000;

function makeDb(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, eq: [], in: null, order: [], range: null };
    calls.push(call);
    const rows = () => {
      let result = tables[table] ?? [];
      for (const [column, value] of call.eq) result = result.filter((row) => !(column in row) || row[column] === value);
      if (call.in) {
        const [column, values] = call.in;
        result = result.filter((row) => values.includes(String(row[column])));
      }
      const [lo, hi] = call.range ?? [0, PAGE - 1];
      // PostgREST's own ceiling: never more than 1000 rows in one answer.
      return result.slice(lo, Math.min(hi + 1, lo + PAGE));
    };
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.neq = () => builder;
    builder.eq = (column: string, value: unknown) => {
      call.eq.push([column, value]);
      return builder;
    };
    builder.in = (column: string, values: string[]) => {
      call.in = [column, values];
      return builder;
    };
    builder.order = (column: string) => {
      call.order.push(column);
      return builder;
    };
    builder.range = (lo: number, hi: number) => {
      call.range = [lo, hi];
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(onF, onR);
    return builder;
  };
  const signed: string[][] = [];
  const storage = {
    from: () => ({
      createSignedUrls: async (keys: string[]) => {
        signed.push(keys);
        return { data: keys.map((key) => ({ path: key, signedUrl: `https://signed.test/${key}` })) };
      },
    }),
  };
  return { supabase: { from, storage } as never, calls, signed };
}

const CUSTOMER = { id: "c1", name: "חברת אלון", active: true, phone: "050-1234567" };

function orders(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    order_id: `o${String(i).padStart(4, "0")}`,
    customer_id: "c1",
    order_date: "2026-09-01",
    status: "delivered",
    total_amount: 100,
    collected_amount: 100,
  }));
}

function viewer(role = "admin") {
  return { role: Promise.resolve(role), viewerId: Promise.resolve("u1") };
}

beforeEach(() => {
  for (const fn of Object.values(libs)) fn.mockClear();
});

describe("the customer page's reads", () => {
  it("reads every payment — 75 order payments, past the 60 it used to keep", async () => {
    const payments = Array.from({ length: 75 }, (_, i) => ({
      id: `pay${String(i).padStart(3, "0")}`,
      order_id: "o0000",
      amount_total: 10,
      payment_date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
      payment_status: "cleared",
    }));
    const { supabase } = makeDb({ customers: [CUSTOMER], order_overview_view: orders(1), payments });
    const reads = startCustomerPageReads(supabase, "c1", viewer());
    const result = await reads.payments;
    expect(result.error).toBeNull();
    expect(result.payments).toHaveLength(75);
    expect(result.lastPaymentAt).toBe("2026-09-28");
    // Newest first, the id deciding a tie.
    expect(result.payments[0]!.date).toBe("2026-09-28");
    expect(result.payments[0]!.source).toEqual({ type: "order", id: "o0000", label: "" });
  });

  it("pages past the database's 1000 rows, and sends no id list longer than 150", async () => {
    const many = orders(1200);
    const payments = many.map((order, i) => ({ id: `p${i}`, order_id: order.order_id, amount_total: 1, payment_date: "2026-09-01" }));
    const { supabase, calls } = makeDb({ customers: [CUSTOMER], order_overview_view: many, payments });
    const reads = startCustomerPageReads(supabase, "c1", viewer());
    const top = await reads.top;
    expect(top!.orders).toHaveLength(1200);
    const orderPages = calls.filter((call) => call.table === "order_overview_view").map((call) => call.range);
    expect(orderPages).toEqual([
      [0, 999],
      [1000, 1999],
    ]);

    const result = await reads.payments;
    expect(result.payments).toHaveLength(1200);
    const batches = calls.filter((call) => call.table === "payments" && call.in?.[0] === "order_id").map((call) => call.in![1]);
    expect(Math.max(...batches.map((batch) => batch.length))).toBeLessThanOrEqual(150);
    expect(new Set(batches.flat()).size).toBe(1200);
  });

  it("orders every list with a tie-breaker", async () => {
    const { supabase, calls } = makeDb({
      customers: [CUSTOMER],
      order_overview_view: orders(2),
      projects: [{ id: "p1", customer_id: "c1", name: "פרויקט" }],
      tasks: [{ id: "t1", customer_id: "c1", subject: "לחזור", status: "todo" }],
      document_links: [{ document_id: "d1", entity_type: "customer", entity_id: "c1" }],
      documents: [{ id: "d1", title: "חוזה", storage_key: "k1" }],
    });
    const reads = startCustomerPageReads(supabase, "c1", viewer());
    await Promise.all([reads.top, reads.payments, reads.documents]);
    const lastOrder = (table: string) =>
      calls.filter((call) => call.table === table && call.order.length > 0).map((call) => call.order[call.order.length - 1]);
    expect(new Set(lastOrder("order_overview_view"))).toEqual(new Set(["order_id"]));
    for (const table of ["projects", "contacts", "customer_branches", "morning_documents", "tasks", "users", "payments", "lease_agreements", "documents"]) {
      for (const column of lastOrder(table)) expect(column, table).toBe("id");
    }
  });

  it("sends the light reads before the role check answers, and the management ones after", async () => {
    const { supabase, calls } = makeDb({ customers: [CUSTOMER] });
    let answer: (role: string) => void = () => {};
    const role = new Promise<string>((resolve) => {
      answer = resolve;
    });
    const reads = startCustomerPageReads(supabase, "c1", { role, viewerId: Promise.resolve("u1") });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const early = new Set(calls.map((call) => call.table));
    for (const table of ["customers", "order_overview_view", "projects", "lease_agreements", "contacts", "customer_branches", "entity_tags", "morning_documents", "document_links"]) {
      expect(early.has(table), table).toBe(true);
    }
    expect(early.has("tasks")).toBe(false);
    expect(libs.getCustomerReceivables).toHaveBeenCalled();

    answer("office");
    const top = await reads.top;
    expect(calls.some((call) => call.table === "tasks")).toBe(true);
    expect(libs.getCustomerActivity).toHaveBeenCalled();
    expect(top!.customer.name).toBe("חברת אלון");
    // Office: no history.
    await reads.history;
    expect(libs.getEntityAuditTrail).not.toHaveBeenCalled();
  });

  it("has no top for a customer that doesn't exist", async () => {
    const { supabase } = makeDb({});
    const reads = startCustomerPageReads(supabase, "missing", viewer());
    expect(await reads.top).toBeNull();
  });

  it("hands the page its call log and receivables, so the גבייה panel needn't fetch them again", async () => {
    const receivables = [{ source_type: "order", outstanding_amount: 50, days_late: 2 }];
    libs.getCustomerReceivables.mockResolvedValueOnce(receivables);
    libs.getCustomerActivity.mockResolvedValueOnce({ logs: [{ id: "l1" }], reminders: [{ id: "r1", status: "pending" }] } as never);
    const { supabase } = makeDb({ customers: [CUSTOMER] });
    const top = await startCustomerPageReads(supabase, "c1", viewer()).top;
    expect(top!.collection.receivables).toBe(receivables);
    expect(top!.collection.logs).toEqual([{ id: "l1" }]);
    expect(top!.collection.reminders).toEqual([{ id: "r1", status: "pending" }]);
    expect(libs.getCustomerReceivables).toHaveBeenCalledTimes(1);
  });

  it("lists the documents by their order/project link, signs only those shown, and counts them all", async () => {
    const links = [
      { document_id: "d0", entity_type: "customer", entity_id: "c1" },
      { document_id: "d1", entity_type: "order", entity_id: "o0000" },
      // d0 is also on the order: the order is the source shown.
      { document_id: "d0", entity_type: "order", entity_id: "o0000" },
      ...Array.from({ length: 12 }, (_, i) => ({ document_id: `e${i}`, entity_type: "customer", entity_id: "c1" })),
    ];
    const documents = [
      { id: "d0", title: "חוזה", file_name: "contract.pdf", storage_key: "k0", uploaded_at: "2026-10-10T08:00:00Z" },
      { id: "d1", title: null, file_name: "invoice.pdf", storage_key: "k1", uploaded_at: "2026-10-11T08:00:00Z" },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, title: `מסמך ${i}`, storage_key: `ke${i}`, uploaded_at: "2026-09-01T08:00:00Z" })),
    ];
    const { supabase, signed } = makeDb({ customers: [CUSTOMER], order_overview_view: orders(1), document_links: links, documents });
    const result = await startCustomerPageReads(supabase, "c1", viewer()).documents;
    expect(result.total).toBe(14);
    expect(result.documents).toHaveLength(10);
    expect(result.documents[0]).toMatchObject({ id: "d1", name: "invoice.pdf", sourceType: "order", url: "https://signed.test/k1" });
    expect(result.documents[1]).toMatchObject({ id: "d0", name: "חוזה", sourceType: "order", sourceId: "o0000" });
    expect(signed.flat()).toHaveLength(10);
  });

  it("asks the history for each ≤150 payment ids as their own source (admin)", async () => {
    const { supabase } = makeDb({ customers: [CUSTOMER], order_overview_view: orders(320) });
    await startCustomerPageReads(supabase, "c1", viewer("admin")).history;
    const sources = libs.getEntityAuditTrail.mock.calls[0]![1] as unknown as Array<{ tableName: string; values?: string[] }>;
    const orderSources = sources.filter((source) => source.values);
    expect(orderSources.map((source) => source.values!.length)).toEqual([150, 150, 20]);
    expect(sources[0]).toEqual({ tableName: "customers", recordId: "c1" });
  });

  it("works the money out from the orders and the projects with their payments", async () => {
    const { supabase } = makeDb({
      customers: [CUSTOMER],
      order_overview_view: [{ order_id: "o1", customer_id: "c1", order_date: "2026-10-01", total_amount: 1000, collected_amount: 250, remaining_balance: 750 }],
      projects: [{ id: "p1", customer_id: "c1", name: "שיפוץ", agreed_base_price: 2000, actual_price: 0, price_includes_vat: false }],
      project_financials_view: [{ id: "p1", customer_total_price: 2000, expenses_billed: 0 }],
      payments: [{ id: "x1", project_id: "p1", amount_total: 500, net_amount: null, payment_status: "cleared", payment_date: "2026-09-15" }],
    });
    const reads = startCustomerPageReads(supabase, "c1", viewer());
    const top = await reads.top;
    expect(top!.money).toMatchObject({ totalSales: 3000, totalPaid: 750, openBalance: 2250, lastOrderAt: "2026-10-01" });
    expect(top!.projects[0]).toMatchObject({ id: "p1", name: "שיפוץ", collected: 500, totalPrice: 2000 });
    const payments = await reads.payments;
    expect(payments.payments[0]!.source).toEqual({ type: "project", id: "p1", label: "שיפוץ" });
  });

  it("states מאזן מול העסק for a lender who works here, with his salary beside it", async () => {
    libs.getCustomerLoanPositions.mockResolvedValueOnce({ owedToUs: 0, owedByUs: 4000, loans: [] });
    const { supabase } = makeDb({
      customers: [{ ...CUSTOMER, linked_user_id: "w1" }],
      users: [{ id: "w1", full_name: "יוסי", email: "y@x.co" }],
      worker_balance_summary_view: [{ user_id: "w1", owed_amount: 1200 }],
    });
    const top = await startCustomerPageReads(supabase, "c1", viewer()).top;
    expect(top!.linkedWorker).toEqual({ id: "w1", name: "יוסי" });
    expect(top!.customer.linkedUserId).toBe("w1");
    expect(top!.balance).toMatchObject({ loansOwedByUs: 4000, net: -4000, payrollOwed: 1200 });
  });

  it("states nothing when there's nothing on either side", async () => {
    const { supabase } = makeDb({ customers: [CUSTOMER] });
    const top = await startCustomerPageReads(supabase, "c1", viewer()).top;
    expect(top!.balance).toBeNull();
    expect(top!.linkedWorker).toBeNull();
  });

  it("lists a tenant's leases and the rent paid on them", async () => {
    const { supabase } = makeDb({
      customers: [CUSTOMER],
      lease_agreements: [
        { id: "l1", customer_id: "c1", property_id: "pr1", start_date: null, monthly_rent_amount: "3500", status: "active", deposit_type: "cash", deposit_amount: 7000, property: [{ id: "pr1", name: null, address: "הגפן 4" }] },
      ],
      payments: [{ id: "rent1", property_id: "pr1", amount_total: 3500, payment_date: "2026-10-01", payment_status: "cleared" }],
    });
    const reads = startCustomerPageReads(supabase, "c1", viewer());
    const top = await reads.top;
    expect(top!.leases).toEqual([
      { id: "l1", propertyId: "pr1", label: "הגפן 4", status: "active", startDate: null, endDate: null, monthlyRentAmount: 3500, depositType: "cash", depositAmount: 7000 },
    ]);
    const payments = await reads.payments;
    expect(payments.payments[0]!.source).toEqual({ type: "property", id: "pr1", label: "הגפן 4" });
  });

  it("lists the tasks — a private one only for its owner — with who has them and an open reminder", async () => {
    const { supabase } = makeDb({
      customers: [CUSTOMER],
      tasks: [
        { id: "t1", customer_id: "c1", subject: "לחזור", status: "todo", assigned_user_id: "u2", is_private: false },
        { id: "t2", customer_id: "c1", subject: "שלי", status: "todo", is_private: true, private_owner_id: "u1" },
        { id: "t3", customer_id: "c1", subject: "של אחר", status: "todo", is_private: true, private_owner_id: "u9" },
      ],
      reminders: [{ id: "rm1", task_id: "t1", status: "pending" }],
      users: [
        { id: "u2", full_name: "דנה", active: true },
        { id: "u3", full_name: "", email: "old@x.co", active: false },
      ],
    });
    const top = await startCustomerPageReads(supabase, "c1", viewer()).top;
    expect(top!.tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
    expect(top!.tasks[0]).toMatchObject({ assigned_user_name: "דנה", has_open_reminder: true });
    expect(top!.taskUsers).toEqual([{ id: "u2", label: "דנה", color: null }]);
  });

  it("states an orders read that failed, in Hebrew, instead of an empty list", async () => {
    const { supabase } = makeDb({ customers: [CUSTOMER] });
    const failing = {
      ...(supabase as unknown as Record<string, unknown>),
      from: (table: string) => {
        const builder = (supabase as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
        if (table !== "order_overview_view") return builder;
        builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: "permission denied for view order_overview_view" } }).then(onF, onR);
        return builder;
      },
    };
    const top = await startCustomerPageReads(failing as never, "c1", viewer()).top;
    expect(top!.orders).toEqual([]);
    expect(top!.errors.orders).toBeTruthy();
    expect(top!.errors.orders).not.toMatch(/permission denied/);
  });
});
