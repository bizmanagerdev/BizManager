import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatWorkedMinutes,
  loadActivityToday,
  personHighlights,
  summarizeDayRows,
  workedMinutesToday,
  type DayLogRow,
} from "@/lib/activity/today";
import { parseActivitySearch, searchActivity } from "@/lib/activity/search";

// "היום בעסק" and each person's day, worked out from the day's log; and the
// search box's words turned into what the log stores.

const row = (r: Partial<DayLogRow> & { table_name: string; action: string; created_at: string }): DayLogRow => ({
  changed_by: "auth-dani",
  status_to: null,
  status_from: null,
  amount: null,
  ...r,
});

const userIdOf = (value: string) => ({ "auth-dani": "dani", dani: "dani", "auth-ruti": "ruti" })[value] ?? null;

describe("summarizeDayRows", () => {
  it("counts people's actions by Israel's hour, not the system's or the side-rows'", () => {
    const { actions, hourly, people } = summarizeDayRows(
      [
        // 08:15 Israel (UTC+3)
        row({ table_name: "orders", action: "INSERT", created_at: "2026-10-11T05:15:00Z" }),
        row({ table_name: "order_items", action: "INSERT", created_at: "2026-10-11T05:15:00Z" }),
        row({ table_name: "inventory_movements", action: "INSERT", created_at: "2026-10-11T05:15:00Z" }),
        row({ table_name: "payslips", action: "UPDATE", created_at: "2026-10-11T05:20:00Z", changed_by: null }),
        row({ table_name: "auth", action: "login", created_at: "2026-10-11T05:00:00Z" }),
      ],
      userIdOf
    );
    expect(actions).toBe(1);
    expect(hourly[8]).toBe(1);
    const dani = people.get("dani");
    expect(dani?.orders).toBe(1);
    expect(dani?.loginAt).toBe("2026-10-11T05:00:00Z");
    expect(people.size).toBe(1);
  });

  it("the person behind a login id and a users.id is one person", () => {
    const { people } = summarizeDayRows(
      [
        row({ table_name: "tasks", action: "INSERT", created_at: "2026-10-11T06:00:00Z", changed_by: "auth-dani" }),
        row({ table_name: "tasks", action: "INSERT", created_at: "2026-10-11T07:00:00Z", changed_by: "dani" }),
      ],
      userIdOf
    );
    expect(people.get("dani")?.tasksNew).toBe(2);
  });

  it("a task counts as done only when it moved to done", () => {
    const { people } = summarizeDayRows(
      [
        row({ table_name: "tasks", action: "UPDATE", created_at: "2026-10-11T06:00:00Z", status_from: "todo", status_to: "done" }),
        row({ table_name: "tasks", action: "UPDATE", created_at: "2026-10-11T06:10:00Z", status_from: "done", status_to: "done" }),
        row({ table_name: "tasks", action: "UPDATE", created_at: "2026-10-11T06:20:00Z" }),
      ],
      userIdOf
    );
    expect(people.get("dani")?.tasksDone).toBe(1);
  });

  it("payments add up their amounts; a delivery is an order moved to delivered", () => {
    const { people } = summarizeDayRows(
      [
        row({ table_name: "payments", action: "INSERT", created_at: "2026-10-11T06:00:00Z", amount: "1500" }),
        row({ table_name: "payments", action: "INSERT", created_at: "2026-10-11T06:05:00Z", amount: "200.5" }),
        row({ table_name: "orders", action: "UPDATE", created_at: "2026-10-11T06:30:00Z", status_from: "draft", status_to: "delivered" }),
      ],
      userIdOf
    );
    const dani = people.get("dani");
    expect(dani?.payments).toBe(2);
    expect(dani?.paymentsTotal).toBe(1700.5);
    expect(dani?.deliveries).toBe(1);
    expect(dani?.firstAt).toBe("2026-10-11T06:00:00Z");
    expect(dani?.lastAt).toBe("2026-10-11T06:30:00Z");
  });
});

describe("workedMinutesToday", () => {
  const start = Date.parse("2026-10-10T21:00:00Z"); // 11 Oct, 00:00 Israel
  const end = Date.parse("2026-10-11T21:00:00Z");

  it("clips a shift from last night at midnight", () => {
    expect(workedMinutesToday([{ user_id: "u", clock_in: "2026-10-10T20:00:00Z", clock_out: "2026-10-10T22:00:00Z" }], start, end, end)).toBe(60);
  });

  it("counts an open shift up to now", () => {
    const now = Date.parse("2026-10-11T07:30:00Z");
    expect(workedMinutesToday([{ user_id: "u", clock_in: "2026-10-11T05:00:00Z", clock_out: null }], start, end, now)).toBe(150);
  });

  it("doesn't count a forgotten clock-out past 16 hours", () => {
    const now = Date.parse("2026-10-11T20:59:00Z");
    expect(workedMinutesToday([{ user_id: "u", clock_in: "2026-10-10T21:00:00Z", clock_out: null }], start, end, now)).toBe(16 * 60);
  });
});

describe("personHighlights / formatWorkedMinutes", () => {
  it("one or many, biggest things first", () => {
    const p = {
      userId: "dani", actions: 9, firstAt: null, lastAt: null, loginAt: null, logoutAt: null,
      orders: 3, deliveries: 0, payments: 1, paymentsTotal: 4700, tasksNew: 0, tasksDone: 1,
      expenses: 0, customers: 0, projects: 0, documents: 0, hourly: Array(24).fill(0), shift: null,
    };
    expect(personHighlights(p)).toEqual(["3 הזמנות חדשות", "תשלום אחד · ₪4,700", "משימה בוצעה"]);
  });

  it("hours and minutes", () => {
    expect(formatWorkedMinutes(515)).toBe("8 שע' 35 דק'");
    expect(formatWorkedMinutes(480)).toBe("8 שע'");
    expect(formatWorkedMinutes(42)).toBe("42 דק'");
  });
});

describe("loadActivityToday", () => {
  function fakeClient(tables: Record<string, unknown[]>) {
    const calls: { table: string; method: string; args: unknown[] }[] = [];
    const client = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        for (const method of ["select", "gte", "lt", "in", "neq", "or", "order", "range"]) {
          q[method] = (...args: unknown[]) => {
            calls.push({ table, method, args });
            return q;
          };
        }
        q.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
        return q;
      },
    };
    return { client: client as unknown as SupabaseClient, calls };
  }

  it("money by method, the orders opened (a new order is a 'draft' until delivered), tasks done of those for today, and the hours", async () => {
    const { client, calls } = fakeClient({
      users: [{ id: "dani", auth_user_id: "auth-dani" }],
      audit_logs: [row({ table_name: "orders", action: "INSERT", created_at: "2026-10-11T06:00:00Z" })],
      payments: [
        { amount_total: 1000, payment_method: "check" },
        { amount_total: 500, payment_method: "cash" },
        { amount_total: 300, payment_method: "check" },
      ],
      orders: [
        { total_amount: 2000, status: "delivered" },
        { total_amount: 999, status: "draft" },
      ],
      tasks: [{ id: "t1" }],
      attendance_sessions: [{ user_id: "dani", clock_in: "2026-10-11T05:00:00Z", clock_out: "2026-10-11T07:00:00Z" }],
    });
    const today = await loadActivityToday(client, "2026-10-11", Date.parse("2026-10-11T09:00:00Z"));
    expect(today.money).toEqual({ total: 1800, count: 3, methods: [{ label: "צ׳ק", total: 1300 }, { label: "מזומן", total: 500 }] });
    expect(today.orders).toEqual({ count: 2, total: 2999 });
    // the same fake answers both task questions with t1: done today, and nothing else open
    expect(today.tasks).toEqual({ done: 1, of: 1 });
    expect(today.hours).toEqual({ minutes: 120, workers: 1, onShiftNow: 0 });
    expect(today.people[0].shift).toEqual({ clockIn: "2026-10-11T05:00:00Z", clockOut: "2026-10-11T07:00:00Z", minutes: 120 });
    expect(today.actions).toBe(1);
    // the day starts at Israel's midnight
    // the payments recorded today (not dated today), from Israel's midnight
    expect(calls.find((c) => c.table === "payments" && c.method === "gte")?.args).toEqual(["created_at", "2026-10-10T21:00:00.000Z"]);
  });
});

describe("parseActivitySearch", () => {
  it("every way of writing צ׳ק is a check", () => {
    for (const q of ["צ'ק", "צ׳ק", "צ’ק", "צק"]) expect(parseActivitySearch(q).values).toEqual(["check", "cheque"]);
  });

  it("an amount, with or without ₪ and commas", () => {
    expect(parseActivitySearch("₪1,500").amount).toBe(1500);
    expect(parseActivitySearch("800").amount).toBe(800);
    expect(parseActivitySearch("כהן").amount).toBeNull();
  });

  it("a name stays a name", () => {
    expect(parseActivitySearch("  כהן  בנייה ")).toEqual({ text: "כהן בנייה", values: [], amount: null });
  });

  it("nothing typed — nothing to search", () => {
    expect(parseActivitySearch("   ").text).toBeNull();
  });
});

describe("searchActivity", () => {
  it("asks the database's search with the stored values, filters and the page's end", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await searchActivity({ rpc } as unknown as SupabaseClient, "צ׳ק", {
      action: "create",
      tableName: "payments",
      before: { createdAt: "2026-10-11T08:00:00Z", id: "x" },
      limit: 10,
    });
    expect(rpc).toHaveBeenCalledWith("search_activity", {
      p_text: "צ׳ק",
      p_values: ["check", "cheque"],
      p_amount: null,
      p_table: "payments",
      p_actions: ["create", "INSERT"],
      p_actors: null,
      p_before_at: "2026-10-11T08:00:00Z",
      p_before_id: "x",
      p_limit: 11,
    });
  });

  it("says plainly when the search isn't in the database yet", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.search_activity" } }));
    const page = await searchActivity({ rpc } as unknown as SupabaseClient, "כהן");
    expect(page.error).toBe("החיפוש עוד לא הופעל במערכת");
  });
});
