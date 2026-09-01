import { describe, it, expect, vi, beforeEach } from "vitest";
import { invalidateAuditFlagCache, logAuditEvent, TRIGGER_AUDITED_TABLES } from "@/lib/audit";

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
