import { describe, it, expect } from "vitest";
import { coerceRow, createLocalSupabase, normalizeTimestamp, type LocalReader } from "@/lib/powersync/local-supabase";
import { getPropertiesSummary } from "@/lib/properties";
import { getMyTasks } from "@/lib/dashboard/tasks-overview";

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
    const notSynced = await db.from("expenses").select("id");
    expect(notSynced.error?.message).toMatch(/expenses/);
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
