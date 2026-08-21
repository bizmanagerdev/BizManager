import { describe, it, expect, vi } from "vitest";

// getScheduleEntries pulls reminders through lib/communications — stub it out
// so these tests only exercise the tasks/projects/orders query construction
// and entry-mapping logic that lives in projectSchedule.ts itself.
vi.mock("@/lib/communications", () => ({
  getOpenReminders: vi.fn(async () => []),
  actionTypeLabel: (v: string | null | undefined) => v ?? "—",
}));

import { getScheduleEntries } from "@/lib/projectSchedule";

type Resp = { data: unknown; error: unknown };

function makeSupabase(responses: Record<string, Resp>, calls: string[] = []) {
  const from = (table: string) => {
    const resp = responses[table] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "not", "order", "range", "eq", "in", "or"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push(`${table}.${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return builder;
      };
    }
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from };
}

const emptyBase = { tasks: { data: [], error: null }, projects: { data: [], error: null } };

describe("getScheduleEntries — delivery (requested delivery date) entries", () => {
  it("maps an open order's requested_delivery_date into a delivery entry", async () => {
    const supabase = makeSupabase({
      ...emptyBase,
      orders: {
        data: [
          {
            id: "ord-1",
            customer_id: "cust-1",
            status: "confirmed",
            requested_delivery_date: "2024-06-01",
            created_by: "u1",
          },
        ],
        error: null,
      },
      customers: { data: [{ id: "cust-1", name: "יעקב הלר" }], error: null },
    });

    const entries = await getScheduleEntries(supabase as never, { scope: "all", userId: "u1" });
    const delivery = entries.find((e) => e.kind === "delivery");
    expect(delivery).toBeDefined();
    expect(delivery).toMatchObject({
      id: "ord-1",
      kind: "delivery",
      title: "יעקב הלר",
      href: "/sales/orders/ord-1",
      startDate: "2024-06-01",
      endDate: "2024-06-01",
      status: "confirmed",
    });
  });

  it("queries orders excluding null requested_delivery_date and every closed status, including legacy Hebrew ones", async () => {
    const calls: string[] = [];
    const supabase = makeSupabase(
      { ...emptyBase, orders: { data: [], error: null }, customers: { data: [], error: null } },
      calls
    );

    await getScheduleEntries(supabase as never, { scope: "all", userId: "u1" });

    const notNullCall = calls.find((c) => c.startsWith("orders.not") && c.includes("requested_delivery_date"));
    expect(notNullCall).toBeDefined();

    const statusFilterCall = calls.find((c) => c.startsWith("orders.not") && c.includes("status"));
    expect(statusFilterCall).toBeDefined();
    for (const status of ["delivered", "completed", "closed", "cancelled", "סופקה", "הושלמה", "סגורה", "בוטלה"]) {
      expect(statusFilterCall).toContain(status);
    }
  });

  it("scopes 'mine' delivery orders by created_by", async () => {
    const calls: string[] = [];
    const supabase = makeSupabase(
      { ...emptyBase, orders: { data: [], error: null }, customers: { data: [], error: null } },
      calls
    );

    await getScheduleEntries(supabase as never, { scope: "mine", userId: "u-42" });

    expect(calls).toContain(`orders.eq("created_by","u-42")`);
  });

  it("under 'mine', an order I didn't create still shows up if I'm a recipient", async () => {
    const supabase = makeSupabase({
      ...emptyBase,
      orders: {
        data: [
          {
            id: "ord-7",
            customer_id: "cust-1",
            status: "confirmed",
            requested_delivery_date: "2024-06-03",
            created_by: "someone-else",
          },
        ],
        error: null,
      },
      order_delivery_recipients: { data: [{ order_id: "ord-7" }], error: null },
      customers: { data: [{ id: "cust-1", name: "יעקב הלר" }], error: null },
    });

    const entries = await getScheduleEntries(supabase as never, { scope: "mine", userId: "driver-1" });
    expect(entries.find((e) => e.kind === "delivery")?.id).toBe("ord-7");
  });

  it("composes an .or() filter (created_by OR recipient order ids) when I have recipient rows", async () => {
    const calls: string[] = [];
    const supabase = makeSupabase(
      {
        ...emptyBase,
        orders: { data: [], error: null },
        order_delivery_recipients: { data: [{ order_id: "ord-7" }, { order_id: "ord-8" }], error: null },
        customers: { data: [], error: null },
      },
      calls
    );

    await getScheduleEntries(supabase as never, { scope: "mine", userId: "driver-1" });

    const orCall = calls.find((c) => c.startsWith("orders.or("));
    expect(orCall).toBeDefined();
    expect(orCall).toContain("created_by.eq.driver-1");
    expect(orCall).toContain("ord-7");
    expect(orCall).toContain("ord-8");
    // No recipients → no .or() at all, just the plain eq (asserted separately below).
    expect(calls.some((c) => c.startsWith("orders.eq") && c.includes("created_by"))).toBe(false);
  });

  it("does not scope orders by created_by under 'all'", async () => {
    const calls: string[] = [];
    const supabase = makeSupabase(
      { ...emptyBase, orders: { data: [], error: null }, customers: { data: [], error: null } },
      calls
    );

    await getScheduleEntries(supabase as never, { scope: "all", userId: "u-42" });

    expect(calls.some((c) => c.startsWith("orders.eq") && c.includes("created_by"))).toBe(false);
  });

  it("resolves customer names through one shared lookup for both a project and a delivery entry", async () => {
    const supabase = makeSupabase({
      tasks: { data: [], error: null },
      projects: {
        data: [
          {
            id: "proj-1",
            name: "פרויקט בדיקה",
            status: "active",
            start_date: "2024-06-01",
            end_date: "2024-06-05",
            project_manager_id: "u1",
            customer_id: "cust-9",
          },
        ],
        error: null,
      },
      orders: {
        data: [
          {
            id: "ord-2",
            customer_id: "cust-9",
            status: "draft",
            requested_delivery_date: "2024-06-02",
            created_by: "u1",
          },
        ],
        error: null,
      },
      customers: { data: [{ id: "cust-9", name: "לקוח משותף" }], error: null },
    });

    const entries = await getScheduleEntries(supabase as never, { scope: "all", userId: "u1" });
    const project = entries.find((e) => e.kind === "project");
    const delivery = entries.find((e) => e.kind === "delivery");
    expect(project?.subtitle).toBe("לקוח משותף");
    expect(delivery?.title).toBe("לקוח משותף");
  });
});
