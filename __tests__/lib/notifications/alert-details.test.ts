import { describe, expect, it } from "vitest";
import {
  firstName,
  formatQuantity,
  itemsSummary,
  joinParts,
  newOrderAlert,
  newProjectAlert,
  newTaskAlert,
  shortDay,
} from "@/lib/notifications/alert-details";

// Alerts carry a little more, and no more (owner, 2026-10-11: an order is its
// items and who entered it, no price; a project its name, start and who opened
// it; a task its name, due date, urgency and who gave it).

type Rows = Record<string, Array<Record<string, unknown>>>;

/** A read-only stand-in for the admin client: eq / in filters over fixed rows. */
function fakeAdmin(rows: Rows) {
  return {
    from(table: string) {
      let result = [...(rows[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          result = result.filter((row) => row[column] === value);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          result = result.filter((row) => values.includes(row[column]));
          return builder;
        },
        range: () => builder,
        maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
      };
      return builder;
    },
  } as never;
}

describe("the small helpers", () => {
  it("quantities lose their trailing zeros", () => {
    expect(formatQuantity("2.00")).toBe("2");
    expect(formatQuantity("1.50")).toBe("1.5");
    expect(formatQuantity(3)).toBe("3");
  });

  it("lists up to three items, each with its number (a single one too), then how many more", () => {
    expect(
      itemsSummary([
        { name: "מזרן", quantity: "2" },
        { name: "פח", quantity: "1" },
        { name: "כרית", quantity: "4" },
        { name: "שמיכה", quantity: "1" },
        { name: "סדין", quantity: "2" },
      ])
    ).toBe("2 מזרן, 1 פח, 4 כרית ועוד 2");
    expect(itemsSummary([{ name: "התקנה", quantity: "" }])).toBe("התקנה");
    expect(itemsSummary([])).toBeNull();
  });

  it("names today and tomorrow, and writes other days short", () => {
    const now = new Date("2026-10-11T09:00:00Z");
    expect(shortDay("2026-10-11", now)).toBe("היום");
    expect(shortDay("2026-10-12", now)).toBe("מחר");
    expect(shortDay("2026-10-14", now)).toBe("14.10");
    expect(shortDay(null, now)).toBeNull();
  });

  it("first names and joined parts", () => {
    expect(firstName("דוד לוי")).toBe("דוד");
    expect(firstName(null)).toBeNull();
    expect(joinParts(["a", null, "", false, "b"])).toBe("a · b");
  });
});

describe("newOrderAlert", () => {
  const rows: Rows = {
    orders: [{ id: "o1", customer_id: "c1", total_amount: "3250", requested_delivery_date: "2030-01-05" }],
    order_items: [
      { order_id: "o1", product_id: "p1", quantity_ordered: "2.00" },
      { order_id: "o1", product_id: "p2", quantity_ordered: "1.00" },
      { order_id: "o1", product_id: null, description: "התקנה", quantity_ordered: "1" },
    ],
    products: [
      { id: "p1", name: "מזרן" },
      { id: "p2", name: "פח" },
    ],
    customers: [{ id: "c1", name: "כהן משה" }],
    users: [{ id: "u1", full_name: "דוד לוי" }],
  };

  it("says who it's for, what was ordered and who entered it — no price", async () => {
    const alert = await newOrderAlert(fakeAdmin(rows), "o1", "u1");
    expect(alert.title).toBe("🧾 הזמנה חדשה: כהן משה");
    expect(alert.body).toBe("2 מזרן, 1 פח, 1 התקנה\nהוזנה ע״י דוד");
  });

  it("an order it can't read still alerts", async () => {
    const alert = await newOrderAlert(fakeAdmin({}), "missing", null);
    expect(alert).toEqual({ title: "🧾 הזמנה חדשה", body: "נוספה הזמנה חדשה למערכת." });
  });
});

describe("newProjectAlert", () => {
  it("its name, when it starts and who opened it", async () => {
    const alert = await newProjectAlert(
      fakeAdmin({
        projects: [{ id: "pr1", name: "דירת כהן", customer_id: "c1", project_type: "moving", agreed_base_price: "8000", start_date: "2030-03-14" }],
        users: [{ id: "u1", full_name: "דוד" }],
      }),
      "pr1",
      "u1"
    );
    expect(alert).toEqual({ title: "📁 פרויקט חדש: דירת כהן", body: "מתחיל 14.3 · נפתח ע״י דוד" });
  });
});

describe("newTaskAlert", () => {
  it("the task, then when it's due, whether it's urgent and who gave it", async () => {
    const alert = await newTaskAlert(
      fakeAdmin({
        tasks: [{ id: "t1", due_date: "2030-02-01", due_time: "10:00:00", priority: "urgent", customer_id: "c1" }],
        users: [{ id: "u1", full_name: "דוד לוי" }],
      }),
      "t1",
      "להתקשר לספק",
      "u1"
    );
    expect(alert).toEqual({ title: "📋 משימה חדשה", body: "להתקשר לספק\nעד 1.2 10:00 · דחוף · מדוד" });
  });

  it("a plain task is just its subject", async () => {
    const alert = await newTaskAlert(fakeAdmin({ tasks: [{ id: "t2", priority: "medium" }] }), "t2", "לסדר מחסן", null);
    expect(alert.body).toBe("לסדר מחסן");
  });
});
