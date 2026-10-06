import { describe, it, expect, vi } from "vitest";
import { coerceRow, createLocalSupabase, normalizeTimestamp, type LocalReader } from "@/lib/powersync/local-supabase";
import { getPropertiesSummary } from "@/lib/properties";
import { getMyTasks } from "@/lib/dashboard/tasks-overview";
import { loadProjectsPage } from "@/app/(app)/projects/loadProjects";
import { loadOrdersPage } from "@/app/(app)/sales/loadOrders";
import { loadDeliveriesPage } from "@/app/(app)/sales/loadDeliveries";
import { loadPriceListPage } from "@/app/(app)/sales/loadProducts";
import { loadTaskPickerOptions, loadTasksBoard } from "@/app/(app)/tasks/loadTasks";

// The on-device stand-in for the Supabase client: the server's loaders run
// against it unchanged, so it has to answer exactly like PostgREST — values
// in Postgres shape, filters with SQL's NULL rules, Postgres sort order.

type Row = Record<string, unknown>;

/** A fake device database: rows as PowerSync stores them (1/0, numeric text). */
function fakeReader(tables: Record<string, Row[]>): LocalReader & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async getAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      queries.push(sql);
      const match = /^SELECT \* FROM ([a-z_]+)(?: WHERE (.*))?$/.exec(sql);
      if (!match) throw new Error(`fake reader can't run: ${sql}`);
      let rows = tables[match[1]] ?? [];
      if (match[2]) {
        let p = 0;
        for (const clause of match[2].split(" AND ")) {
          const eq = /^([a-z_]+) = \?$/.exec(clause);
          const inList = /^([a-z_]+) IN \(([?,]+)\)$/.exec(clause);
          if (eq) {
            const value = params[p++];
            rows = rows.filter((r) => r[eq[1]] === value);
          } else if (inList) {
            const n = inList[2].split(",").length;
            const values = params.slice(p, p + n);
            p += n;
            rows = rows.filter((r) => values.includes(r[inList[1]]));
          } else {
            throw new Error(`fake reader can't filter: ${clause}`);
          }
        }
      }
      return rows.map((r) => ({ ...r })) as T[];
    },
  };
}

describe("value shapes (PowerSync → PostgREST)", () => {
  it("turns 1/0 into booleans, numeric text into numbers, json text into objects", () => {
    expect(
      coerceRow("orders", { id: "o1", collect_payment_on_delivery: 1, needs_invoice: 0, total_amount: "120.50", notes: "x" })
    ).toEqual({ id: "o1", collect_payment_on_delivery: true, needs_invoice: false, total_amount: 120.5, notes: "x" });
    expect(coerceRow("users", { id: "u1", notification_prefs: '{"muted":["tasks"]}' }).notification_prefs).toEqual({
      muted: ["tasks"],
    });
    expect(coerceRow("projects", { id: "p1", items_to_move: '["sofa","bed"]' }).items_to_move).toEqual(["sofa", "bed"]);
  });

  it("drops the made-up id of pair-keyed tables (it isn't a Postgres column)", () => {
    expect(coerceRow("task_members", { id: "t1:u1", task_id: "t1", user_id: "u1" })).toEqual({ task_id: "t1", user_id: "u1" });
  });

  it("reads every timestamp as UTC, whatever form it arrives in", () => {
    expect(normalizeTimestamp("2026-10-06T14:29:30.123456")).toBe("2026-10-06T14:29:30.123Z");
    expect(normalizeTimestamp("2026-10-06T14:29:30.123456Z")).toBe("2026-10-06T14:29:30.123Z");
    expect(normalizeTimestamp("2026-10-06 14:29:30")).toBe("2026-10-06T14:29:30.000Z");
    expect(normalizeTimestamp("2026-10-06T14:29:30+00:00")).toBe("2026-10-06T14:29:30.000Z");
    expect(normalizeTimestamp("2026-10-06T17:29:30+03:00")).toBe("2026-10-06T14:29:30.000Z");
    expect(normalizeTimestamp("2026-10-06")).toBe("2026-10-06");
    expect(normalizeTimestamp("שלום")).toBe("שלום");
  });
});

describe("filters", () => {
  const db = createLocalSupabase(
    fakeReader({
      orders: [
        { id: "o1", status: "confirmed", created_by: "u1", requested_delivery_date: "2026-10-07", total_amount: "10" },
        { id: "o2", status: "delivered", created_by: "u2", requested_delivery_date: "2026-10-05", total_amount: "20" },
        { id: "o3", status: null, created_by: "u2", requested_delivery_date: null, total_amount: "30" },
        { id: "o4", status: "draft", created_by: "u3", requested_delivery_date: "2026-10-08", total_amount: "40" },
      ],
    })
  );
  const ids = (data: unknown) => (data as Row[]).map((r) => r.id);

  it("not.in leaves out NULLs, like SQL", async () => {
    const { data } = await db.from("orders").select("id").not("status", "in", "(delivered,completed)");
    expect(ids(data)).toEqual(["o1", "o4"]);
  });

  it("is null / not is null", async () => {
    expect(ids((await db.from("orders").select("id").is("status", null)).data)).toEqual(["o3"]);
    expect(ids((await db.from("orders").select("id").not("requested_delivery_date", "is", null)).data)).toEqual([
      "o1",
      "o2",
      "o4",
    ]);
  });

  it("or() with a nested and(), as PostgREST writes it", async () => {
    const { data } = await db
      .from("orders")
      .select("id")
      .or("created_by.eq.u1,and(status.is.null,created_by.eq.u2),id.in.(o4)");
    expect(ids(data)).toEqual(["o1", "o3", "o4"]);
  });

  it("numbers compare as numbers; dates against timestamps", async () => {
    expect(ids((await db.from("orders").select("id").gte("total_amount", 25)).data)).toEqual(["o3", "o4"]);
    const tasks = createLocalSupabase(
      fakeReader({ tasks: [{ id: "t1", due_date: "2026-10-05T21:00:00.000000" }, { id: "t2", due_date: "2026-10-06T00:00:00.000000" }] })
    );
    expect(ids((await tasks.from("tasks").select("id").lt("due_date", "2026-10-06")).data)).toEqual(["t1"]);
    expect(ids((await tasks.from("tasks").select("id").eq("due_date", "2026-10-06T00:00:00+00:00")).data)).toEqual(["t2"]);
  });

  it("pushes exact id/status matches into SQL", async () => {
    const reader = fakeReader({ orders: [{ id: "o1", status: "draft" }, { id: "o2", status: "draft" }] });
    const local = createLocalSupabase(reader);
    await local.from("orders").select("id").in("id", ["o2"]).eq("status", "draft");
    expect(reader.queries).toEqual(["SELECT * FROM orders WHERE id IN (?) AND status = ?"]);
  });
});

describe("order, range, count, single", () => {
  const db = createLocalSupabase(
    fakeReader({
      projects: [
        { id: "a", name: "בית", start_date: "2026-10-03" },
        { id: "b", name: "אולם", start_date: null },
        { id: "c", name: "גן", start_date: "2026-10-01" },
      ],
    })
  );

  it("ascending puts NULLs last, descending puts them first", async () => {
    const asc = await db.from("projects").select("id").order("start_date", { ascending: true });
    expect((asc.data as Row[]).map((r) => r.id)).toEqual(["c", "a", "b"]);
    const desc = await db.from("projects").select("id").order("start_date", { ascending: false });
    expect((desc.data as Row[]).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts Hebrew text alphabetically", async () => {
    const { data } = await db.from("projects").select("name").order("name");
    expect((data as Row[]).map((r) => r.name)).toEqual(["אולם", "בית", "גן"]);
  });

  it("range + count report the page and the full match count", async () => {
    const { data, count } = await db.from("projects").select("id", { count: "estimated" }).order("id").range(1, 1);
    expect(data).toEqual([{ id: "b" }]);
    expect(count).toBe(3);
  });

  it("maybeSingle: one row, none, or an error for many", async () => {
    expect((await db.from("projects").select("id").eq("id", "a").maybeSingle()).data).toEqual({ id: "a" });
    expect((await db.from("projects").select("id").eq("id", "zz").maybeSingle()).data).toBeNull();
    expect((await db.from("projects").select("id").maybeSingle()).error).not.toBeNull();
  });
});

describe("select lists", () => {
  it("renames, embeds the related row, and refuses columns the device doesn't have", async () => {
    const db = createLocalSupabase(
      fakeReader({
        lease_agreements: [{ id: "l1", customer_id: "c1", status: "active" }],
        customers: [{ id: "c1", name: "דנה", phone: "050" }],
      })
    );
    const { data } = await db.from("lease_agreements").select("id,state:status,customer:customers(name)");
    expect(data).toEqual([{ id: "l1", state: "active", customer: { name: "דנה" } }]);

    const missing = await db.from("lease_agreements").select("id,nonexistent");
    expect(missing.error?.message).toMatch(/nonexistent/);
    const notSynced = await db.from("audit_logs").select("id");
    expect(notSynced.error?.message).toMatch(/audit_logs/);
  });

  it("one-to-many: the children as a list; !inner keeps only parents with a matching child", async () => {
    const db = createLocalSupabase(
      fakeReader({
        tasks: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
        task_members: [
          { id: "t1:me", task_id: "t1", user_id: "me" },
          { id: "t1:u2", task_id: "t1", user_id: "u2" },
          { id: "t2:u2", task_id: "t2", user_id: "u2" },
        ],
      })
    );
    const all = await db.from("tasks").select("id,task_members(user_id)").order("id");
    expect(all.data).toEqual([
      { id: "t1", task_members: [{ user_id: "me" }, { user_id: "u2" }] },
      { id: "t2", task_members: [{ user_id: "u2" }] },
      { id: "t3", task_members: [] },
    ]);
    const mine = await db.from("tasks").select("id,task_members!inner(user_id)").eq("task_members.user_id", "me");
    expect(mine.data).toEqual([{ id: "t1", task_members: [{ user_id: "me" }] }]);
  });
});

describe("views and directories", () => {
  it("order_financials_view: collected = cleared/unknown payments, summed exactly", async () => {
    const db = createLocalSupabase(
      fakeReader({
        orders: [{ id: "o1", total_amount: "0.3" }, { id: "o2", total_amount: "100" }],
        payments: [
          { id: "p1", order_id: "o1", amount_total: "0.1", payment_status: "cleared" },
          { id: "p2", order_id: "o1", amount_total: "0.2", payment_status: null },
          { id: "p3", order_id: "o2", amount_total: "50", payment_status: "pending" },
          { id: "p4", order_id: "o2", amount_total: "30", payment_status: "rejected" },
        ],
      })
    );
    const { data } = await db.from("order_financials_view").select("id,total_amount,total_paid,payment_status").in("id", ["o1", "o2"]);
    expect(data).toEqual([
      { id: "o1", total_amount: 0.3, total_paid: 0.3, payment_status: "paid" },
      { id: "o2", total_amount: 100, total_paid: 0, payment_status: "unpaid" },
    ]);
  });

  it("delivery_overview_view: open orders only, city = the part before '|'", async () => {
    const db = createLocalSupabase(
      fakeReader({
        orders: [
          { id: "o1", customer_id: "c1", branch_id: "b1", status: "confirmed", total_amount: "5", notes: "  " },
          { id: "o2", customer_id: "c1", branch_id: null, status: "delivered", total_amount: "5" },
        ],
        customers: [{ id: "c1", name: " ", name_for_invoice: "חברה בע״מ", address: "חיפה | הרצל 1", phone: "" }],
        customer_branches: [{ id: "b1", name: "סניף", address: "עכו|הנמל 2" }],
      })
    );
    const { data } = await db.from("delivery_overview_view").select("order_id,customer_name,customer_city,branch_city,notes,customer_phone");
    expect(data).toEqual([
      { order_id: "o1", customer_name: "חברה בע״מ", customer_city: "חיפה", branch_city: "עכו", notes: null, customer_phone: null },
    ]);
  });

  it("user_directory() and property_directory() as RPCs, filterable", async () => {
    const db = createLocalSupabase(
      fakeReader({
        users: [
          { id: "u1", full_name: "א", role: "admin", active: 1 },
          { id: "u2", full_name: "ב", role: "worker_no_access", active: 1 },
        ],
        properties: [{ id: "pr1", name: null, address: "רחוב 1", is_active: 0 }],
      })
    );
    const users = await db.rpc("user_directory").neq("role", "worker_no_access");
    expect(users.data).toEqual([{ id: "u1", full_name: "א", avatar_color: undefined, role: "admin", active: true }]);
    const props = await db.rpc("property_directory").eq("id", "pr1").maybeSingle();
    expect(props.data).toEqual({ id: "pr1", name: null, address: "רחוב 1", is_active: false });
  });
});

describe("the server's own loaders, run on the device copy", () => {
  it("getPropertiesSummary: vacant and expiring, same rules as the server", async () => {
    const db = createLocalSupabase(
      fakeReader({
        properties: [
          { id: "p1", name: "דירה 1", address: "א", is_active: 1 },
          { id: "p2", name: null, address: "רחוב ב", is_active: 1 },
          { id: "p3", name: "סגור", address: "ג", is_active: 0 },
        ],
        lease_agreements: [{ id: "l1", property_id: "p1", customer_id: "c1", status: "active", end_date: "2026-11-01" }],
        customers: [{ id: "c1", name: "שוכר" }],
      })
    );
    const summary = await getPropertiesSummary(db, "2026-10-06");
    expect(summary.vacant).toEqual([{ id: "p2", label: "רחוב ב" }]);
    expect(summary.expiring).toEqual([
      { id: "l1", propertyId: "p1", label: "דירה 1", tenantName: "שוכר", endDate: "2026-11-01", daysLeft: 26 },
    ]);
  });

  it("getMyTasks: mine + member tasks, open only, with project names", async () => {
    const db = createLocalSupabase(
      fakeReader({
        task_members: [{ id: "t2:me", task_id: "t2", user_id: "me" }],
        // Device rows always carry every column of the table (null when empty).
        tasks: [
          { id: "t1", subject: "שלי", status: "todo", assigned_user_id: "me", project_id: "p1", created_at: "2026-10-05T10:00:00.000000", due_date: null },
          { id: "t2", subject: "חבר", status: "in_progress", assigned_user_id: "other", project_id: null, created_at: "2026-10-06T10:00:00.000000", due_date: "2026-10-01T00:00:00.000000" },
          { id: "t3", subject: "סגורה", status: "done", assigned_user_id: "me", project_id: null, created_at: "2026-10-06T11:00:00.000000", due_date: null },
          { id: "t4", subject: "של אחר", status: "todo", assigned_user_id: "other", project_id: null, created_at: "2026-10-06T12:00:00.000000", due_date: null },
        ].map((t) => ({ subject_he: null, subject_ar: null, priority: "medium", ...t })),
        projects: [{ id: "p1", name: "פרויקט" }],
        reminders: [],
      })
    );
    const tasks = await getMyTasks(db, "me", "he");
    expect(tasks.map((t) => [t.id, t.project_name, t.overdue])).toEqual([
      ["t2", null, true],
      ["t1", "פרויקט", false],
    ]);
  });
});

describe("the money views, worked out on the device", () => {
  // One worked example, every figure by hand. "Today" is 2026-10-06 (UTC —
  // the database's CURRENT_DATE).
  const tables = {
    users: [
      { id: "u1", full_name: "שעתי", pay_tracking_mode: "session" },
      { id: "u2", full_name: "חודשי", pay_tracking_mode: "payslip" },
    ],
    attendance_sessions: [
      // 22:30 UTC on 30 Sept: UTC date 2026-09-30.
      { id: "s1", user_id: "u1", clock_in: "2026-09-30T22:30:00.000000", labor_cost: "150.50", worked_minutes: 300, project_id: "p1", is_billable_to_customer: 1, bill_to_customer_amount: "200", business_domain: null, property_id: null },
      { id: "s2", user_id: "u1", clock_in: "2026-10-01T08:00:00.000000", labor_cost: "0", worked_minutes: 60, project_id: "p1", is_billable_to_customer: 0, bill_to_customer_amount: null, business_domain: null, property_id: null },
      { id: "s3", user_id: "u2", clock_in: "2026-10-02T08:00:00.000000", labor_cost: "100", worked_minutes: 60, project_id: null, is_billable_to_customer: 0, bill_to_customer_amount: null, business_domain: null, property_id: null },
    ],
    payslips: [{ id: "ps1", user_id: "u2", payroll_period_id: "pp1", gross_salary: "5000", total_work_minutes: 9000 }],
    payroll_periods: [{ id: "pp1", end_date: "2026-08-31", period_month: "2026-08" }],
    salary_agreements: [
      { id: "a1", user_id: "u2", valid_from: "2026-01-01", valid_to: null, due_day_of_next_month: 15, business_domain: "logistics_projects", project_id: "p1", property_id: null, is_billable_to_customer: 1, bill_to_customer_amount: "6000" },
      { id: "a2", user_id: "u2", valid_from: "2026-09-01", valid_to: null, due_day_of_next_month: 1, business_domain: null, project_id: null, property_id: null, is_billable_to_customer: 0, bill_to_customer_amount: null },
    ],
    worker_payments: [
      { id: "wp1", payment_date: "2026-10-01" },
      { id: "wp2", payment_date: "2026-09-15" },
    ],
    worker_payment_allocations: [
      { id: "al1", worker_payment_id: "wp1", source_type: "session", attendance_session_id: "s1", payslip_id: null, amount: "50" },
      { id: "al2", worker_payment_id: "wp2", source_type: "payslip", attendance_session_id: null, payslip_id: "ps1", amount: "5000" },
      { id: "al3", worker_payment_id: "gone", source_type: "session", attendance_session_id: "s1", payslip_id: null, amount: "999" },
    ],
    projects: [
      { id: "p1", name: "הובלה", customer_id: "c1", actual_price: "1000", agreed_base_price: null, price_includes_vat: 1, vat_rate: "0.18", status: "active" },
      { id: "p2", name: "בלי מחיר", customer_id: "c-missing", actual_price: null, agreed_base_price: null, price_includes_vat: 0, vat_rate: null, status: "active" },
    ],
    project_expenses: [
      { id: "pe1", project_id: "p1", expense_id: "e1", billed_to_customer: 1 },
      { id: "pe2", project_id: "p1", expense_id: "e2", billed_to_customer: 0 },
    ],
    expenses: [
      { id: "e1", amount: "100" },
      { id: "e2", amount: "50" },
    ],
    payments: [
      { id: "pay1", project_id: "p1", net_amount: "500", amount_total: "590", vat_amount: "90", payment_status: "cleared", payment_date: "2026-09-20T10:00:00.000000", due_date: null },
      { id: "pay2", project_id: "p1", net_amount: null, amount_total: "300", vat_amount: null, payment_status: "pending", payment_date: "2026-09-01T10:00:00.000000", due_date: "2026-10-01" },
      { id: "pay3", project_id: "p1", net_amount: "1000", amount_total: "1000", vat_amount: null, payment_status: "rejected", payment_date: "2026-09-02T10:00:00.000000", due_date: null },
      { id: "pay4", project_id: "p2", net_amount: null, amount_total: "250", vat_amount: null, payment_status: null, payment_date: "2026-09-25T10:00:00.000000", due_date: null },
    ],
    customers: [{ id: "c1", name: "לקוח", phone: "050" }],
    tasks: [
      { id: "t1", project_id: "p1", status: "done" },
      { id: "t2", project_id: "p1", status: "todo" },
    ],
  };

  it("worker_debt_items_view: earned, paid and owed per shift and payslip", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
    try {
      const db = createLocalSupabase(fakeReader(tables));
      const { data } = await db.from("worker_debt_items_view").select("*").order("source_type");
      expect(data).toEqual([
        expect.objectContaining({
          source_type: "payslip",
          source_id: "ps1",
          project_id: "p1",
          source_date: "2026-08-31",
          due_date: "2026-09-15",
          period_month: "2026-08",
          earned_amount: 5000,
          paid_amount: 5000,
          owed_amount: 0,
          payment_status: "paid",
          business_domain: "logistics_projects",
          is_billable_to_customer: true,
          bill_to_customer_amount: 6000,
          last_payment_date: "2026-09-15",
        }),
        expect.objectContaining({
          source_type: "session",
          source_id: "s1",
          source_date: "2026-09-30",
          period_month: "2026-09",
          earned_amount: 150.5,
          paid_amount: 50,
          owed_amount: 100.5,
          payment_status: "partial",
          business_domain: "general_business",
          last_payment_date: "2026-10-01",
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("project_financials_view: price with VAT, billed costs, profit, collected / pending / overdue", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
    try {
      const db = createLocalSupabase(fakeReader(tables));
      const { data } = await db.from("project_financials_view").select("*").order("id");
      const [p1, p2] = data as Row[];
      expect(p1).toMatchObject({
        // 1000 × 1.18 + billed expense 100 + billable shift 200 + billable payslip 6000
        customer_total_price: 7480,
        // expenses 150 + labour 150.5 + payslip 5000
        total_expenses: 5300.5,
        gross_profit: 2179.5,
        expenses_billed: 6300,
        collected_amount: 500,
        pending_amount: 300,
        overdue_amount: 300,
        outstanding_amount: 6980,
        gross_collected: 590,
        vat_collected: 90,
        next_due_date: "2026-10-01",
        last_payment_date: "2026-09-20",
      });
      // No price: the money collected is the price.
      expect(p2).toMatchObject({ customer_total_price: 250, collected_amount: 250, gross_profit: 250, outstanding_amount: 0, next_due_date: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("inner lookups with a filter on the linked row, and the worker balance per project", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
    try {
      const db = createLocalSupabase(
        fakeReader({
          ...tables,
          expenses: [
            { id: "e1", amount: "100", paid_amount: "0", payment_status: "not_paid" },
            { id: "e2", amount: "50", paid_amount: "50", payment_status: "paid" },
          ],
        })
      );
      const { data } = await db
        .from("project_expenses")
        .select("project_id,expenses!inner(id,payment_status)")
        .in("expenses.payment_status", ["not_paid", "partial"]);
      expect(data).toEqual([{ project_id: "p1", expenses: { id: "e1", payment_status: "not_paid" } }]);

      const balance = await db.from("project_worker_balance_view").select("project_id,earned_amount,paid_amount,owed_amount");
      // Only the payslip is on p1 (the shift's project is p1 too): 5000 + 150.5 earned, 5050 paid, 100.5 owed.
      expect(balance.data).toEqual([{ project_id: "p1", earned_amount: 5150.5, paid_amount: 5050, owed_amount: 100.5 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the projects list loader, end to end on the device copy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
    try {
      const db = createLocalSupabase(fakeReader(tables));
      const result = await loadProjectsPage(db, {
        page: 1,
        filters: { view: "projects", status: "all", customerId: null, sort: "recent", q: "" },
      });
      expect(result.error).toBeNull();
      expect(result.rows.map((r) => [r.id, r.gross_profit, r.customer_total_price, r.we_owe_amount])).toEqual([
        // p2 has no customer row, so (like the view's inner join) it isn't listed.
        // We owe on p1: the shift's unpaid 100.5 (the payslip is fully paid).
        ["p1", 2179.5, 7480, 100.5],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("project_dashboard_view: needs a customer; task progress; money from the financials", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
    try {
      const db = createLocalSupabase(fakeReader(tables));
      const { data } = await db.from("project_dashboard_view").select("id,customer_name,total_tasks,completed_tasks,open_tasks,gross_profit,customer_phone");
      expect(data).toEqual([
        { id: "p1", customer_name: "לקוח", total_tasks: 2, completed_tasks: 1, open_tasks: 1, gross_profit: 2179.5, customer_phone: "050" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the sales tabs, worked out on the device", () => {
  const tables = {
    customers: [
      { id: "c1", name: "  ", name_for_invoice: "חברה", phone: "050", email: null, address: "חיפה|הרצל 1" },
    ],
    users: [{ id: "u1", full_name: "מנהל", email: "a@b.c" }],
    customer_branches: [],
    orders: [
      { id: "o1", customer_id: "c1", created_by: "u1", branch_id: null, status: "confirmed", order_date: "2026-10-05T08:00:00.000000", created_at: "2026-10-05T08:00:00.000000", total_amount: "100", discount_amount: "0", notes: null, needs_invoice: 1, invoice_sent_at: null, delivery_confirmed_at: null },
      { id: "o2", customer_id: "c1", created_by: "u1", branch_id: null, status: "delivered", order_date: "2026-10-04T08:00:00.000000", created_at: "2026-10-04T08:00:00.000000", total_amount: "50", discount_amount: "0", notes: null, needs_invoice: 0, invoice_sent_at: null, delivery_confirmed_at: null },
    ],
    payments: [
      { id: "p1", order_id: "o1", amount_total: "40", payment_status: "cleared", due_date: null },
      { id: "p2", order_id: "o1", amount_total: "60", payment_status: "pending", due_date: "2026-10-01" },
    ],
    order_items: [],
    products: [
      { id: "pr1", name: "כיסא", sku: "S1", barcode: null, description: null, base_price: "10", base_cost: "5", active: 1, category_id: "cat1", low_stock_threshold: "2" },
    ],
    inventory: [{ id: "pr1", product_id: "pr1", quantity_on_hand: "7", quantity_reserved: "1", updated_at: "2026-10-05T08:00:00.000000" }],
    inventory_movements: [
      { id: "m1", product_id: "pr1", movement_type: "in", quantity: "10", source_type: "purchase", notes: null },
      { id: "m2", product_id: "pr1", movement_type: "out", quantity: "4", source_type: "order", notes: null },
      { id: "m3", product_id: "pr1", movement_type: "in", quantity: "1", source_type: "manual_adjustment", notes: "החזרת לקוח - פגום" },
    ],
    product_categories: [{ id: "cat1", name: "ריהוט", active: 1 }],
  };

  it("order_overview_view: names, money and payment status per order", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
    try {
      const db = createLocalSupabase(fakeReader(tables));
      const { data } = await db.from("order_overview_view").select("order_id,customer_name,customer_city,total_paid,pending_amount,overdue_amount,remaining_balance,payment_status,created_by_name,needs_invoice").eq("order_id", "o1").maybeSingle();
      expect(data).toEqual({
        order_id: "o1",
        customer_name: "חברה",
        customer_city: "חיפה",
        total_paid: 40,
        pending_amount: 60,
        overdue_amount: 60,
        remaining_balance: 60,
        payment_status: "partial",
        created_by_name: "מנהל",
        needs_invoice: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("the orders tab loader: open orders only, newest first", async () => {
    const db = createLocalSupabase(fakeReader(tables));
    const result = await loadOrdersPage(db, {
      page: 1,
      filters: { tab: "orders", customerId: null, q: "", paymentStatus: "", invoice: "" },
    });
    expect(result.error).toBeNull();
    expect(result.rows.map((r) => r.order_id ?? r.id)).toEqual(["o1"]);
  });

  it("the price list loader: stock, purchased and sold (net of customer returns)", async () => {
    const db = createLocalSupabase(fakeReader(tables));
    const result = await loadPriceListPage(db, { page: 1, filters: { q: "", category: "" } });
    expect(result.error).toBeNull();
    expect(result.categories).toEqual([expect.objectContaining({ id: "cat1", name: "ריהוט" })]);
    expect(result.products).toEqual([
      expect.objectContaining({ id: "pr1", name: "כיסא", stock: 7, purchasedAmount: 11, soldAmount: 3, unitPrice: 10 }),
    ]);
  });
});

describe("the tasks board, worked out on the device", () => {
  const task = (row: Row) => ({
    subject_he: null, subject_ar: null, priority: "medium", due_date: null, due_time: null, city: null,
    business_domain: null, project_id: null, property_id: null, customer_id: null, is_private: 0,
    private_owner_id: null, sort_order: null, updated_at: "2026-10-01T08:00:00.000000", ...row,
  });
  const tables = {
    tasks: [
      task({ id: "t1", subject: "שלי", status: "todo", assigned_user_id: "me", sort_order: 2, created_at: "2026-10-05T10:00:00.000000", due_date: "2026-01-01" }),
      task({ id: "t2", subject: "חבר", status: "in_progress", assigned_user_id: "u2", sort_order: 1, created_at: "2026-10-04T10:00:00.000000", property_id: "pr1", customer_id: "c1" }),
      task({ id: "t3", subject: "של אחר", status: null, assigned_user_id: "u2", created_at: "2026-10-03T10:00:00.000000" }),
      task({ id: "t4", subject: "סגורה", status: "done", assigned_user_id: "me", created_at: "2026-09-01T10:00:00.000000", updated_at: "2026-10-05T12:00:00.000000" }),
      task({ id: "t5", subject: "פרטית", status: "todo", assigned_user_id: null, is_private: 1, private_owner_id: "me", created_at: "2026-10-06T10:00:00.000000" }),
      task({ id: "t6", subject: "בוטלה", status: "cancelled", assigned_user_id: "me", created_at: "2026-10-06T11:00:00.000000" }),
    ],
    task_members: [{ id: "t2:me", task_id: "t2", user_id: "me" }],
    users: [
      { id: "me", full_name: "אני", avatar_color: "#111", role: "admin", active: 1 },
      { id: "u2", full_name: "דנה", avatar_color: "#222", role: "worker", active: 1 },
    ],
    customers: [{ id: "c1", name: "לקוח", phone: "050" }],
    properties: [{ id: "pr1", name: null, address: "רחוב 1", is_active: 1 }],
    task_comments: [
      { id: "cm1", task_id: "t1" },
      { id: "cm2", task_id: "t1" },
    ],
    reminders: [
      { id: "r1", task_id: "t2", remind_at: "2026-10-07T08:00:00.000000", status: "pending" },
      { id: "r2", task_id: "t1", remind_at: "2026-10-07T08:00:00.000000", status: "done" },
    ],
    document_links: [
      { id: "dl1", entity_type: "task", entity_id: "t1", document_id: "d1" },
      { id: "dl2", entity_type: "order", entity_id: "t2", document_id: "d2" },
    ],
  };
  const filters = { q: "", priority: "", domain: "", linkedId: "" };

  it("mine: assigned, member or my private task; open by board order, then done", async () => {
    const db = createLocalSupabase(fakeReader(tables));
    const { items, error } = await loadTasksBoard(db, { filters: { ...filters, scope: "mine" }, userId: "me", canSeeAll: true });
    expect(error).toBeNull();
    expect(items.map((t) => t.id)).toEqual(["t2", "t1", "t5", "t4"]);
    const [t2, t1] = items;
    expect(t2).toMatchObject({
      members: [
        { id: "u2", name: "דנה", color: "#222" },
        { id: "me", name: "אני", color: "#111" },
      ],
      assigned_user_name: "דנה",
      customer_name: "לקוח",
      customer_phone: "050",
      property_name: "רחוב 1",
      has_open_reminder: true,
      comment_count: 0,
      attachment_count: 0,
      sort_order: 1,
    });
    expect(t1).toMatchObject({ comment_count: 2, attachment_count: 1, has_open_reminder: false, is_overdue: true });
    expect(items.find((t) => t.id === "t5")?.is_private).toBe(true);
  });

  it("all: everyone's tasks; a search still works", async () => {
    const db = createLocalSupabase(fakeReader(tables));
    const all = await loadTasksBoard(db, { filters: { ...filters, scope: "all" }, userId: "me", canSeeAll: true });
    expect(all.items.map((t) => t.id)).toEqual(["t2", "t1", "t5", "t3", "t4"]);
    const search = await loadTasksBoard(db, { filters: { ...filters, q: "חבר", scope: "all" }, userId: "me", canSeeAll: true });
    expect(search.items.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("the task dialog's pickers, worked out on the device", () => {
  it("projects (newest first, with the customer), active properties and customers, people who can be given a task", async () => {
    const reader = fakeReader({
      projects: [
        { id: "p1", name: "ישן", customer_id: "c1", updated_at: "2026-09-01T10:00:00.000000" },
        { id: "p2", name: "חדש", customer_id: "c1", updated_at: "2026-10-01T10:00:00.000000" },
        { id: "p3", name: "בלי לקוח", customer_id: "gone", updated_at: "2026-10-02T10:00:00.000000" },
      ],
      customers: [
        { id: "c1", name: "לקוח", phone: "050", active: 1 },
        { id: "c2", name: "אחר", phone: null, active: 1 },
        { id: "c3", name: "לא פעיל", phone: null, active: 0 },
      ],
      properties: [
        { id: "pr1", name: "בית", address: "רחוב 1", is_active: 1 },
        { id: "pr2", name: null, address: "רחוב 2", is_active: 0 },
      ],
      users: [
        { id: "u1", full_name: "דנה", avatar_color: "#111", role: "worker", active: 1 },
        { id: "u2", full_name: "בלי גישה", avatar_color: null, role: "worker_no_access", active: 1 },
        { id: "u3", full_name: "עזב", avatar_color: null, role: "worker", active: 0 },
      ],
    });
    const options = await loadTaskPickerOptions(createLocalSupabase(reader));
    expect(options.projects).toEqual([
      { id: "p2", label: "חדש (לקוח)" },
      { id: "p1", label: "ישן (לקוח)" },
    ]);
    expect(options.customers.map((c) => c.label)).toEqual(["אחר", "לקוח · 050"]);
    expect(options.properties.map((p) => p.id)).toEqual(["pr1"]);
    expect(options.users).toEqual([{ id: "u1", label: "דנה", color: "#111" }]);
    // The projects picker asks for names only — no money worked out for it.
    expect(reader.queries.some((q) => /FROM (payments|expenses|payslips)/.test(q))).toBe(false);
  });
});

describe("same-day rows keep one order", () => {
  it("deliveries: same order date → the newest order first (the server sorts the same way)", async () => {
    const order = (id: string, created: string) => ({
      id, customer_id: "c1", branch_id: null, status: "confirmed", order_date: "2026-10-05T00:00:00.000000",
      created_at: created, total_amount: "10", notes: null,
    });
    const db = createLocalSupabase(
      fakeReader({
        // Stored oldest first: without the tie-breaker the device would list them that way.
        orders: [order("o-early", "2026-10-05T06:19:59.700113"), order("o-late", "2026-10-05T09:11:43.707316")],
        customers: [{ id: "c1", name: "לקוח", name_for_invoice: null, phone: null, address: null }],
        customer_branches: [],
        order_items: [],
        products: [],
        inventory: [],
        payments: [],
      })
    );
    const { deliveries, error } = await loadDeliveriesPage(db, { page: 1, filters: { customerId: null } });
    expect(error).toBeNull();
    expect(deliveries.map((d) => d.id)).toEqual(["o-late", "o-early"]);
  });
});
