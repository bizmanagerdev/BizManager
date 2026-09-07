import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildAuditFeedItem,
  buildDetails,
  buildFocusHref,
  buildHref,
  buildParentKey,
  invalidateAuditFlagCache,
  logAuditEvent,
  resolvePrivateTaskIds,
  TRIGGER_AUDITED_TABLES,
  type AuditLogRow,
} from "@/lib/audit";
import { formatMoney } from "@/lib/money";

// resolvePrivateTaskIds deliberately bypasses the caller's own (RLS-bound)
// client via createSupabaseAdminClient — falls back to whatever `supabase` it
// was given (see the code comment) when the service key isn't configured, same
// pattern as payroll-sessions-delete.test.ts.
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => null }));

// logAuditEvent is called by nearly every mutating route in the app, and
// every one of those route tests mocks it away as a transparent
// passthrough — this file is where its ACTUAL behavior gets checked.
//
// The most important thing this surfaced: for a "trigger-audited" table
// (payments, expenses, orders, attendance_sessions, ...) doing a plain
// create/update/delete, this function is a deliberate NO-OP — a DB trigger
// already writes that audit row, and logging it again here would double it.
// So the `expect(logAuditEvent).toHaveBeenCalledWith(...)` assertions in
// payments/expenses/orders/payroll-sessions route tests verify the ROUTE
// calls this function correctly, not that an audit row actually gets
// written for those specific table+action pairs — in production, for those,
// it silently does nothing. That's by design (see the code comment), not a
// bug, but it's worth knowing before assuming those assertions mean what
// they look like they mean.

function makeSupabase(opts: { auditEnabled?: boolean | null; insertError?: { message: string } | null } = {}) {
  const calls = { businessSettingsSelects: 0, insert: [] as unknown[] };
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => {
      if (table === "business_settings") {
        calls.businessSettingsSelects += 1;
        return Promise.resolve({
          data: opts.auditEnabled === undefined ? null : { audit_logging_enabled: opts.auditEnabled },
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    builder.insert = (values: unknown) => {
      calls.insert.push(values);
      return Promise.resolve({ error: table === "audit_logs" ? (opts.insertError ?? null) : null });
    };
    return builder;
  };
  return { from, calls };
}

const BASE = {
  tableName: "recurring_expense_templates", // NOT trigger-audited -> a normal write always logs here
  recordId: "rec-1",
  action: "update",
  changedBy: "prof-1",
  userRole: "admin",
};

beforeEach(() => {
  invalidateAuditFlagCache(); // the 60s in-memory flag cache must not leak between tests
});

describe("logAuditEvent — argument guard", () => {
  it("does nothing (no DB call at all) when tableName, recordId or action is missing", async () => {
    const database = makeSupabase();
    await logAuditEvent({ ...BASE, tableName: "", supabase: database as never });
    await logAuditEvent({ ...BASE, recordId: "", supabase: database as never });
    await logAuditEvent({ ...BASE, action: "", supabase: database as never });
    expect(database.calls.insert).toHaveLength(0);
    expect(database.calls.businessSettingsSelects).toBe(0);
  });
});

describe("logAuditEvent — the global audit on/off switch", () => {
  it("does not insert when audit_logging_enabled is explicitly false", async () => {
    const database = makeSupabase({ auditEnabled: false });
    await logAuditEvent({ ...BASE, supabase: database as never });
    expect(database.calls.insert).toHaveLength(0);
  });

  it("defaults to enabled (inserts) when the settings row/column isn't present yet", async () => {
    const database = makeSupabase({ auditEnabled: undefined as never });
    await logAuditEvent({ ...BASE, supabase: database as never });
    expect(database.calls.insert).toHaveLength(1);
  });

  it("caches the flag for repeated calls — only reads business_settings once", async () => {
    const database = makeSupabase({ auditEnabled: true });
    await logAuditEvent({ ...BASE, supabase: database as never });
    await logAuditEvent({ ...BASE, recordId: "rec-2", supabase: database as never });
    expect(database.calls.businessSettingsSelects).toBe(1);
    expect(database.calls.insert).toHaveLength(2);
  });

  it("invalidateAuditFlagCache forces a fresh read on the next call", async () => {
    const database = makeSupabase({ auditEnabled: true });
    await logAuditEvent({ ...BASE, supabase: database as never });
    invalidateAuditFlagCache();
    await logAuditEvent({ ...BASE, recordId: "rec-2", supabase: database as never });
    expect(database.calls.businessSettingsSelects).toBe(2);
  });
});

describe("logAuditEvent — the trigger-audited-table skip", () => {
  it("skips the insert for a trigger-audited table doing a plain CRUD action", async () => {
    const database = makeSupabase({ auditEnabled: true });
    await logAuditEvent({ ...BASE, tableName: "payments", action: "update", supabase: database as never });
    expect(database.calls.insert).toHaveLength(0);
  });

  it("still logs a DISTINCT semantic action on a trigger-audited table (the trigger can't express it)", async () => {
    const database = makeSupabase({ auditEnabled: true });
    await logAuditEvent({
      ...BASE,
      tableName: "payments",
      action: "morning_auto_receipt_failed",
      supabase: database as never,
    });
    expect(database.calls.insert).toHaveLength(1);
  });

  it("logs a plain create/update/delete normally for a table NOT in the trigger-audited set", async () => {
    const database = makeSupabase({ auditEnabled: true });
    expect(TRIGGER_AUDITED_TABLES.has("recurring_expense_templates")).toBe(false);
    await logAuditEvent({ ...BASE, supabase: database as never }); // BASE.tableName is recurring_expense_templates
    expect(database.calls.insert).toHaveLength(1);
  });
});

describe("logAuditEvent — persistence", () => {
  it("persists all the given fields, defaulting the optional ones to null", async () => {
    const database = makeSupabase({ auditEnabled: true });
    await logAuditEvent({ ...BASE, changedBy: undefined, userRole: undefined, supabase: database as never });
    expect(database.calls.insert[0]).toMatchObject({
      table_name: "recurring_expense_templates",
      record_id: "rec-1",
      action: "update",
      changed_by: null,
      user_role: null,
      old_data: null,
      new_data: null,
    });
  });

  it("carries old_data/new_data through when given", async () => {
    const database = makeSupabase({ auditEnabled: true });
    await logAuditEvent({
      ...BASE,
      oldData: { amount: 100 },
      newData: { amount: 200 },
      supabase: database as never,
    });
    expect(database.calls.insert[0]).toMatchObject({ old_data: { amount: 100 }, new_data: { amount: 200 } });
  });
});

describe("logAuditEvent — never throws on a DB error", () => {
  it("swallows an insert error (logs to console, doesn't reject)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = makeSupabase({ auditEnabled: true, insertError: { message: "connection reset" } });
    await expect(logAuditEvent({ ...BASE, supabase: database as never })).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// A payslip/payslip-item audit row used to render with NO details at all
// (buildDetails had no case for either table) — "תלוש שכר · עודכן" and
// nothing else, same bug class as the payments/loans cases documented in
// lib/audit.ts.
describe("buildDetails — payslips / payslip_items", () => {
  it("shows gross salary, salary type, hours and notes for a payslip", () => {
    const details = buildDetails("payslips", {
      gross_salary: 8500,
      calculated_salary_type: "monthly",
      total_work_minutes: 600,
      manual_adjustments: 0,
      notes: "כולל שעות נוספות",
    });
    expect(details).toBe("₪8,500 · גלובלי · 10 שעות · כולל שעות נוספות");
  });

  it("shows a signed manual adjustment (can be negative)", () => {
    const details = buildDetails("payslips", {
      gross_salary: 5000,
      calculated_salary_type: "hourly",
      total_work_minutes: 0,
      manual_adjustments: -150,
      notes: null,
    });
    expect(details).toBe(`₪5,000 · שעתי · התאמה ${formatMoney(-150)}`);
  });

  it("labels the item type and shows the amount for a payslip item", () => {
    const details = buildDetails("payslip_items", { item_type: "bonus", amount: 300, notes: null });
    expect(details).toBe("בונוס · ₪300");
  });

  it("shows a negative amount for a deduction item", () => {
    const details = buildDetails("payslip_items", { item_type: "deduction", amount: -200, notes: "איחור" });
    expect(details).toBe(`ניכוי · ${formatMoney(-200)} · איחור`);
  });
});

describe("buildFocusHref", () => {
  it("appends ?focus= when the path has no query string yet", () => {
    expect(buildFocusHref("/documents", "doc-1")).toBe("/documents?focus=doc-1");
  });
  it("appends &focus= when the path already has a query string", () => {
    expect(buildFocusHref("/collections?filter=overdue", "cust-1")).toBe(
      "/collections?filter=overdue&focus=cust-1"
    );
  });
  it("URL-encodes the id", () => {
    expect(buildFocusHref("/financial", "expense:abc def")).toBe("/financial?focus=expense%3Aabc%20def");
  });
  it("is a no-op (returns the bare path) when the id is falsy", () => {
    expect(buildFocusHref("/documents", null)).toBe("/documents");
    expect(buildFocusHref("/documents", undefined)).toBe("/documents");
    expect(buildFocusHref("/documents", "")).toBe("/documents");
  });
});

// buildHref is what every activity-feed row (and lib/global-search.ts, via the
// same convention) uses to decide where a click lands. A table missing a case
// — or a case that drops the id it already has — is the single most common bug
// class in this file (documented at length in the [[activity-audit-system]]
// project memory): the row renders fine, but clicking it dumps the reader on
// the TOP of a list instead of the record it's actually about.
describe("buildHref", () => {
  it("properties: links straight to the record, not the bare list", () => {
    expect(buildHref("properties", "prop-1", null, null)).toBe("/properties/prop-1");
  });

  it("reminders: a task-linked reminder goes to the task, not /inbox", () => {
    expect(buildHref("reminders", "rem-1", null, { task_id: "task-9" })).toBe("/tasks/task-9");
  });
  it("reminders: falls back to /inbox with no task/customer/project/order link", () => {
    expect(buildHref("reminders", "rem-1", null, {})).toBe("/inbox");
    expect(buildHref("reminders", "rem-1", null, null)).toBe("/inbox");
  });

  it("product_categories: lands on the inventory list WITHOUT a focus id (a category id doesn't match any row's data-focus-id)", () => {
    expect(buildHref("product_categories", "cat-1", null, null)).toBe("/sales?tab=inventory");
  });
  it("products: focuses the specific product row", () => {
    expect(buildHref("products", "prod-1", null, null)).toBe("/sales?tab=inventory&focus=prod-1");
  });

  it("account_transfers: opens the FROM account's register at the transfer's own row", () => {
    expect(buildHref("account_transfers", "transfer-1", null, { from_account_id: "acc-1" })).toBe(
      "/financial/bank?account=acc-1&focus=transfer-1"
    );
  });
  it("account_transfers: still safe (no id-less crash) with no from_account_id on the row", () => {
    expect(buildHref("account_transfers", "transfer-1", null, {})).toBe("/financial/bank?focus=transfer-1");
  });

  it("phone_attendance_reports: focuses the specific report on the attendance queue", () => {
    expect(buildHref("phone_attendance_reports", "report-1", null, null)).toBe(
      "/payroll/attendance?focus=report-1"
    );
  });

  it("recurring_task_templates: focuses the specific template", () => {
    expect(buildHref("recurring_task_templates", "tpl-1", null, null)).toBe("/tasks/recurring?focus=tpl-1");
  });

  it("communications / communication_logs / inquiries: focus the specific row", () => {
    expect(buildHref("communications", "log-1", null, null)).toBe("/communications?focus=log-1");
    expect(buildHref("communication_logs", "log-2", null, null)).toBe("/communications?focus=log-2");
    expect(buildHref("inquiries", "log-3", null, null)).toBe("/communications?focus=log-3");
  });

  it("auth (login/logout) has nowhere to go — stays a dead link on purpose", () => {
    expect(buildHref("auth", "row-1", null, null)).toBeNull();
  });

  it("loan_repayments: goes to the parent loan when its id is known, else the bare loans list", () => {
    expect(buildHref("loan_repayments", "repay-1", null, { loan_id: "loan-1" })).toBe(
      "/financial/loans/loan-1"
    );
    expect(buildHref("loan_repayments", "repay-1", null, {})).toBe("/financial/loans");
  });
});

// A worker-adjacent table only has a user_id, never a page of its own — the
// route has to be inferred by resolving to `worker:<user_id>` first.
describe("buildParentKey — worker resolution", () => {
  it.each(["worker_payments", "attendance_sessions", "payslips", "salary_agreements", "hourly_salary_overrides", "worker_absences"])(
    "%s resolves to worker:<user_id>",
    (table) => {
      expect(buildParentKey(table, "row-1", { user_id: "user-1" }, null)).toBe("worker:user-1");
    }
  );
  it("worker_payment_allocations never resolves (no synchronous join available)", () => {
    expect(buildParentKey("worker_payment_allocations", "row-1", { worker_payment_id: "wp-1" }, null)).toBeNull();
  });
});

// A private task (see tasks-trello-board memory) is hidden from everyone but
// its creator at the tasks-table RLS level — but audit_logs has no such gate,
// so its own row (and anything hung off it: comments, members, reminders,
// attachments) would otherwise leak the task's subject/description straight
// into the admin-wide /activity feed. buildAuditFeedItem must still show that
// SOMETHING happened, just not what.
function makeRow(overrides: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: "row-1",
    table_name: "tasks",
    record_id: "task-1",
    action: "update",
    changed_by: "user-1",
    user_role: "admin",
    created_at: "2026-09-01T00:00:00Z",
    new_data: null,
    old_data: null,
    ...overrides,
  };
}

describe("buildAuditFeedItem — private task redaction", () => {
  it("hides subject/title/changes/link on a private task's own create/update/delete row", () => {
    const row = makeRow({
      new_data: { subject: "פרויקט חשאי", is_private: true },
      old_data: { subject: "ישן", is_private: true },
    });
    const item = buildAuditFeedItem(row, "מישהו", "פרויקט חשאי");
    expect(item.title).toBeNull();
    expect(item.details).toBe("משימה פרטית");
    expect(item.baseDetails).toBe("משימה פרטית");
    expect(item.changes).toEqual([]);
    expect(item.href).toBeNull();
    expect(item.parentKey).toBeNull();
    // The fact that a task-related action happened still shows — this isn't a
    // total blackout, only the content is stripped.
    expect(item.entityLabel).toBe("משימה");
    expect(item.actionLabel).toBe("עודכן");
  });

  it("shows full details for a non-private task (no false positives)", () => {
    const row = makeRow({ new_data: { subject: "בדיקת ציוד", is_private: false } });
    const item = buildAuditFeedItem(row, "מישהו", "בדיקת ציוד");
    expect(item.title).toBe("בדיקת ציוד");
    expect(item.details).toBe("בדיקת ציוד");
    expect(item.href).toBe("/tasks/task-1");
  });

  it("redacts a delete row too (is_private only survives in old_data on a DELETE)", () => {
    const row = makeRow({
      action: "delete",
      new_data: null,
      old_data: { subject: "פרויקט חשאי", is_private: true },
    });
    const item = buildAuditFeedItem(row, "מישהו", "פרויקט חשאי");
    expect(item.title).toBeNull();
    expect(item.details).toBe("משימה פרטית");
  });

  it("redacts a child row (e.g. a document attached to a task) whose task the caller flagged private", () => {
    const row = makeRow({
      table_name: "document_links",
      record_id: "link-1",
      new_data: { entity_type: "task", entity_id: "task-9", document_id: "doc-1" },
    });
    const item = buildAuditFeedItem(row, "מישהו", null, null, new Set(["task-9"]));
    expect(item.details).toBe("משימה פרטית");
    expect(item.href).toBeNull();
    expect(item.parentKey).toBeNull();
  });

  it("does NOT redact a child row whose task isn't in the private set", () => {
    const row = makeRow({
      table_name: "document_links",
      record_id: "link-1",
      new_data: { entity_type: "task", entity_id: "task-9", document_id: "doc-1" },
    });
    const item = buildAuditFeedItem(row, "מישהו", null, null, new Set());
    expect(item.href).toBe("/documents?focus=doc-1");
  });
});

describe("resolvePrivateTaskIds", () => {
  it("looks up is_private only for tasks referenced by CHILD rows, skipping a tasks-table row's own id", async () => {
    const seenIds: string[] = [];
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("tasks");
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => {
              seenIds.push(...ids);
              return Promise.resolve({ data: ids.map((id) => ({ id, is_private: id === "task-private" })) });
            },
          }),
        };
      },
    };
    const rows: AuditLogRow[] = [
      makeRow({ table_name: "tasks", record_id: "task-own", new_data: { is_private: true } }),
      makeRow({ table_name: "task_comments", record_id: "c1", new_data: { task_id: "task-private" } }),
      makeRow({ table_name: "reminders", record_id: "r1", new_data: { task_id: "task-public" } }),
    ];
    const result = await resolvePrivateTaskIds(supabase as never, rows);
    expect([...seenIds].sort()).toEqual(["task-private", "task-public"]);
    expect(result.has("task-private")).toBe(true);
    expect(result.has("task-public")).toBe(false);
    // Not looked up — buildAuditFeedItem reads is_private inline off the row's
    // own data for a tasks-table row, no query needed.
    expect(result.has("task-own")).toBe(false);
  });

  it("skips the query entirely when nothing needs looking up", async () => {
    const from = vi.fn();
    const result = await resolvePrivateTaskIds({ from } as never, [
      makeRow({ table_name: "tasks", new_data: { is_private: true } }),
    ]);
    expect(from).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});
