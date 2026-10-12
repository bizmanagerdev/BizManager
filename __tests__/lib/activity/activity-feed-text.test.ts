import { describe, expect, it } from "vitest";
import { buildAuditFeedItem, type AuditFeedItem, type AuditLogRow } from "@/lib/audit";
import { dayHeading, israelClock, israelDayKeyOf, israelDayStart, shiftDayKey } from "@/lib/activity/days";
import { activityKind } from "@/lib/activity/kinds";
import { isOrderPlumbing, orderLineDiff } from "@/lib/activity/order-lines";
import { activitySentence, detailLine, sentenceTellsStatus, sentenceText, withPrefix } from "@/lib/activity/sentence";

// The activity feed's words: day headings, the sentence for each action, its
// colour/icon kind, and an order save boiled down to what changed in it.

function item(
  row: Partial<AuditLogRow> & { table_name: string; action: string },
  opts: { title?: string | null; actor?: string | null } = {}
): AuditFeedItem {
  return buildAuditFeedItem(
    {
      id: row.id ?? `${row.table_name}-${row.action}-${Math.random()}`,
      record_id: row.record_id ?? "rec-1",
      changed_by: "changed_by" in row ? row.changed_by ?? null : "user-1",
      user_role: "admin",
      created_at: row.created_at ?? "2026-10-11T09:30:00Z",
      new_data: row.new_data ?? null,
      old_data: row.old_data ?? null,
      table_name: row.table_name,
      action: row.action,
    },
    opts.actor ?? "דני",
    opts.title ?? null
  );
}

const text = (i: AuditFeedItem) => sentenceText(activitySentence(i));

describe("days — the feed's headings follow Israel's calendar", () => {
  it("today, yesterday, then the weekday and date", () => {
    expect(dayHeading("2026-10-11", "2026-10-11")).toBe("היום");
    expect(dayHeading("2026-10-10", "2026-10-11")).toBe("אתמול");
    expect(dayHeading("2026-10-08", "2026-10-11")).toBe("יום חמישי · 8.10");
  });

  it("adds the year only for another year", () => {
    expect(dayHeading("2025-12-31", "2026-01-05")).toBe("יום רביעי · 31.12.25");
  });

  it("an action at 00:30 Israel time belongs to that Israeli day, not UTC's previous one", () => {
    // 00:30 on 9 Oct in Israel (summer, UTC+3) is 21:30Z on the 8th.
    expect(israelDayKeyOf("2026-10-08T21:30:00Z")).toBe("2026-10-09");
    expect(israelClock("2026-10-08T21:30:00Z")).toBe("00:30");
  });

  it("summer: the day starts at Israel's midnight (21:00Z the day before), not the server's", () => {
    expect(israelDayStart("2026-10-08").toISOString()).toBe("2026-10-07T21:00:00.000Z");
  });

  it("winter: Israel's midnight is 22:00Z the day before", () => {
    expect(israelDayStart("2026-01-15").toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });

  it("shifts a day key by the calendar across a month's end", () => {
    expect(shiftDayKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("activitySentence — one Hebrew sentence per action, verb first", () => {
  it("a new payment: amount and who it came from", () => {
    const i = item({ table_name: "payments", action: "INSERT", new_data: { amount_total: 1500, payment_method: "check" } }, { title: "כהן בנייה" });
    expect(text(i)).toBe("נרשם תשלום ₪1,500 מכהן בנייה");
    // the method stays for the line under it, the amount isn't said twice
    expect(detailLine(i, activitySentence(i))).toBe("צ׳ק");
  });

  it("joins a preposition to a Hebrew name and hyphenates a foreign one", () => {
    expect(withPrefix("מ", "כהן")).toBe("מכהן");
    expect(withPrefix("ל", "Apple")).toBe("ל-Apple");
  });

  it("orders: opened, delivered, deleted", () => {
    expect(text(item({ table_name: "orders", action: "INSERT", new_data: { total_amount: 3200 } }, { title: "משה לוי" }))).toBe(
      "נפתחה הזמנה למשה לוי"
    );
    const delivered = item(
      { table_name: "orders", action: "UPDATE", new_data: { status: "delivered" }, old_data: { status: "draft" } },
      { title: "משה לוי" }
    );
    expect(text(delivered)).toBe("נמסרה הזמנה למשה לוי");
    expect(sentenceTellsStatus(delivered)).toBe(true);
    expect(text(item({ table_name: "orders", action: "DELETE", old_data: {} }, { title: "משה לוי" }))).toBe("נמחקה הזמנה של משה לוי");
  });

  it("tasks: added, done, reopened", () => {
    expect(text(item({ table_name: "tasks", action: "INSERT", new_data: { subject: "פריקה" } }, { title: "פריקה" }))).toBe(
      "נוספה משימה: פריקה"
    );
    expect(
      text(item({ table_name: "tasks", action: "UPDATE", new_data: { status: "done" }, old_data: { status: "todo" } }, { title: "פריקה" }))
    ).toBe("בוצעה משימה: פריקה");
    expect(
      text(item({ table_name: "tasks", action: "UPDATE", new_data: { status: "todo" }, old_data: { status: "done" } }, { title: "פריקה" }))
    ).toBe("נפתחה מחדש משימה: פריקה");
  });

  it("a private task says only that it changed", () => {
    const i = item({ table_name: "tasks", action: "UPDATE", new_data: { is_private: true, subject: "סוד" }, old_data: { is_private: true } });
    expect(text(i)).toBe("עודכנה משימה פרטית");
    expect(text(i)).not.toContain("סוד");
  });

  it("a work session: in, and out", () => {
    expect(text(item({ table_name: "attendance_sessions", action: "INSERT", new_data: { clock_in: "2026-10-11T05:00:00Z" } }, { title: "נתן" }))).toBe(
      "נרשמה כניסה לעבודה של נתן"
    );
    expect(
      text(
        item(
          { table_name: "attendance_sessions", action: "UPDATE", new_data: { clock_out: "2026-10-11T14:00:00Z" }, old_data: { clock_out: null } },
          { title: "נתן" }
        )
      )
    ).toBe("נרשמה יציאה מהעבודה של נתן");
  });

  it("anything else: the verb agrees with the record (feminine / masculine)", () => {
    expect(text(item({ table_name: "recurring_expense_templates", action: "UPDATE", new_data: {}, old_data: {} }))).toBe("עודכנה הוצאה קבועה");
    expect(text(item({ table_name: "payslips", action: "UPDATE", new_data: {}, old_data: {} }, { title: "נתן" }))).toBe("עודכן תלוש שכר · נתן");
  });

  it("a user's update: their own settings, their permissions, or their details", () => {
    const upd = (n: Record<string, unknown>, o: Record<string, unknown>) =>
      text(item({ table_name: "users", action: "UPDATE", new_data: n as never, old_data: o as never }, { title: "רותי" }));
    expect(upd({ digest_seen_at: "2026-10-11T09:00:00Z", updated_at: "b" }, { digest_seen_at: null, updated_at: "a" })).toBe(
      "עודכנו ההגדרות האישיות של רותי"
    );
    expect(upd({ role: "admin" }, { role: "worker" })).toBe("עודכנו ההרשאות של רותי");
    expect(upd({ phone: "050" }, { phone: "052" })).toBe("עודכנו פרטי המשתמש רותי");
  });

  it("a check's status reads in Hebrew, as on the checks page", () => {
    const i = item({ table_name: "payments", action: "UPDATE", new_data: { payment_status: "cleared" }, old_data: { payment_status: "pending" } });
    expect(i.changes).toEqual([{ label: "סטטוס תשלום", before: "ממתין", after: "נפרע" }]);
  });

  it("logins read as nouns — the person is shown beside them", () => {
    expect(text(item({ table_name: "auth", action: "login" }))).toBe("כניסה למערכת");
  });
});

describe("activityKind — the colour/icon of an entry", () => {
  it("payment green, order blue, task purple, deletion red", () => {
    expect(activityKind(item({ table_name: "payments", action: "INSERT", new_data: {} }))).toBe("payment");
    expect(activityKind(item({ table_name: "orders", action: "INSERT", new_data: {} }))).toBe("order");
    expect(activityKind(item({ table_name: "tasks", action: "INSERT", new_data: {} }))).toBe("task");
    expect(activityKind(item({ table_name: "payments", action: "DELETE", old_data: {} }))).toBe("delete");
  });

  it("a delivered order and a done task have their own", () => {
    expect(activityKind(item({ table_name: "orders", action: "UPDATE", new_data: { status: "delivered" }, old_data: { status: "draft" } }))).toBe(
      "delivery"
    );
    expect(activityKind(item({ table_name: "tasks", action: "UPDATE", new_data: { status: "done" }, old_data: { status: "todo" } }))).toBe(
      "taskDone"
    );
  });

  it("the system's own rows are grey", () => {
    expect(activityKind(item({ table_name: "payslips", action: "UPDATE", changed_by: null, new_data: {}, old_data: {} }))).toBe("system");
  });
});

describe("orderLineDiff — an order save, as what changed in its lines", () => {
  const line = (action: string, product: string, qty: number, name = product) =>
    item({
      table_name: "order_items",
      action,
      ...(action === "DELETE"
        ? { old_data: { order_id: "o1", product_id: product, quantity_ordered: qty, description: name } }
        : { new_data: { order_id: "o1", product_id: product, quantity_ordered: qty, description: name } }),
    });

  it("marking an order delivered rewrites every line unchanged — nothing to show", () => {
    const diff = orderLineDiff([line("DELETE", "bin", 2), line("DELETE", "sand", 1), line("INSERT", "bin", 2), line("INSERT", "sand", 1)]);
    expect(diff).toEqual({ hadLines: true, changes: [] });
  });

  it("a quantity change, a line added and a line removed", () => {
    const diff = orderLineDiff([
      line("DELETE", "bin", 2, "פח"),
      line("DELETE", "sand", 1, "חול"),
      line("INSERT", "bin", 3, "פח"),
      line("INSERT", "cement", 5, "מלט"),
    ]);
    expect(diff.changes).toEqual([
      { kind: "changed", key: "bin", name: "פח", from: 2, to: 3 },
      { kind: "removed", key: "sand", name: "חול", qty: 1 },
      { kind: "added", key: "cement", name: "מלט", qty: 5 },
    ]);
  });

  it("a line edited in place", () => {
    const edited = item({
      table_name: "order_items",
      action: "UPDATE",
      new_data: { order_id: "o1", product_id: "bin", quantity_ordered: 4 },
      old_data: { order_id: "o1", product_id: "bin", quantity_ordered: 2 },
    });
    expect(orderLineDiff([edited]).changes).toEqual([{ kind: "changed", key: "bin", name: "פריט", from: 2, to: 4 }]);
  });

  it("no lines at all → nothing folded", () => {
    expect(orderLineDiff([item({ table_name: "payments", action: "INSERT", new_data: { order_id: "o1" } })]).hadLines).toBe(false);
  });

  it("an order's lines and stock reservations are plumbing; its payment isn't", () => {
    expect(isOrderPlumbing(line("INSERT", "bin", 1))).toBe(true);
    expect(
      isOrderPlumbing(item({ table_name: "inventory_movements", action: "INSERT", new_data: { source_type: "order", source_id: "o1" } }))
    ).toBe(true);
    expect(isOrderPlumbing(item({ table_name: "payments", action: "INSERT", new_data: { order_id: "o1" } }))).toBe(false);
  });
});
