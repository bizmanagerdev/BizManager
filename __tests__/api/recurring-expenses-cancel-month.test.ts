import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase, type MockTableConfig } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/recurring-expenses/cancel-month — "ביטול החודש".
// A month of a recurring bill that didn't happen keeps its row at ₪0, paid,
// with the reason in its note (a deleted month is just generated again), and
// can be put back with `restore`, which hands the month back to the generator.

const { requireRouteAccess, logAuditEvent } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));

import { POST } from "@/app/api/recurring-expenses/cancel-month/route";

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "office" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/recurring-expenses/cancel-month", { method: "POST", body: JSON.stringify(body) }));
}

const unpaidMonth = {
  id: "exp-8",
  recurring_expense_template_id: "tpl-1",
  recurrence_key: "2026-08",
  payment_status: "not_paid",
  amount: 180,
  paid_amount: 0,
  expense_date: "2026-08-10T00:00:00+00:00",
  notes: null,
  currency: "ILS",
  installment_group_id: null,
};

function sb(tables: Record<string, MockTableConfig>) {
  const supabase = makeSupabase(tables);
  const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
  return Object.assign(supabase, { rpc });
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
});

describe("POST /api/recurring-expenses/cancel-month — cancelling", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post({ expense_id: "exp-8" });
    expect(res.status).toBe(403);
  });

  it("400 without a row id or a template + period + date", async () => {
    grant(sb({}));
    expect((await post({})).status).toBe(400);
    expect((await post({ template_id: "tpl-1", recurrence_key: "2026-08" })).status).toBe(400);
  });

  it("keeps the month's row: ₪0, paid on its own date, the default reason in its note", async () => {
    const supabase = sb({ expenses: { data: unpaidMonth, error: null } });
    grant(supabase);
    const res = await post({ expense_id: "exp-8" });
    expect(res.status).toBe(200);
    expect(supabase.calls.delete.expenses).toBeUndefined();
    const [patch] = supabase.calls.update.expenses as Array<Record<string, unknown>>;
    expect(patch).toEqual({
      amount: 0,
      paid_amount: 0,
      payment_status: "paid",
      paid_date: "2026-08-10",
      notes: "בוטל – לא היה חיוב החודש",
    });
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("writes the typed reason and keeps a note the month already had", async () => {
    const supabase = sb({ expenses: { data: { ...unpaidMonth, notes: "הערה קודמת" }, error: null } });
    grant(supabase);
    await post({ expense_id: "exp-8", reason: "  הביטוח הוקפא  " });
    const [patch] = supabase.calls.update.expenses as Array<Record<string, unknown>>;
    expect(patch.notes).toBe("בוטל – הביטוח הוקפא\nהערה קודמת");
  });

  it("a US$ bill stays in dollars — $0 — since its account may hold nothing else", async () => {
    const supabase = sb({ expenses: { data: { ...unpaidMonth, currency: "USD" }, error: null } });
    grant(supabase);
    await post({ expense_id: "exp-8" });
    const [patch] = supabase.calls.update.expenses as Array<Record<string, unknown>>;
    expect(patch).toMatchObject({ amount: 0, foreign_amount: 0, paid_amount: 0 });
    expect(patch).not.toHaveProperty("currency");
  });

  it("refuses a month that is paid, or partly paid — that is corrected by editing the payment", async () => {
    for (const month of [
      { ...unpaidMonth, payment_status: "paid", amount: 310.28, paid_amount: 310.28 },
      { ...unpaidMonth, payment_status: "partial", paid_amount: 50 },
    ]) {
      const supabase = sb({ expenses: { data: month, error: null } });
      grant(supabase);
      const res = await post({ expense_id: "exp-8" });
      expect(res.status).toBe(409);
      expect(supabase.calls.update.expenses).toBeUndefined();
    }
  });

  it("refuses a month that was split into payments", async () => {
    const supabase = sb({ expenses: { data: { ...unpaidMonth, installment_group_id: "grp-1" }, error: null } });
    grant(supabase);
    expect((await post({ expense_id: "exp-8" })).status).toBe(409);
    expect(supabase.calls.update.expenses).toBeUndefined();
  });

  it("a month already cancelled is done — nothing is written again", async () => {
    const supabase = sb({ expenses: { data: { ...unpaidMonth, payment_status: "paid", amount: 0 }, error: null } });
    grant(supabase);
    const res = await post({ expense_id: "exp-8" });
    expect(res.status).toBe(200);
    expect(supabase.calls.update.expenses).toBeUndefined();
  });

  it("a one-off expense isn't a month of anything — it can be deleted instead", async () => {
    const supabase = sb({ expenses: { data: { ...unpaidMonth, recurring_expense_template_id: null }, error: null } });
    grant(supabase);
    expect((await post({ expense_id: "exp-8" })).status).toBe(400);
    expect(supabase.calls.update.expenses).toBeUndefined();
  });

  it("an upcoming month with no row yet is created already cancelled, from its template", async () => {
    const supabase = sb({
      expenses: { read: { data: null, error: null }, write: { data: { id: "exp-new" }, error: null } },
      recurring_expense_templates: {
        data: {
          id: "tpl-1", category: "ביטוח", currency: "ILS", description_template: null, notes_template: null,
          business_domain: "home", project_id: null, order_id: null, property_id: null,
          account_id: "acc-home", included_in_base_price: false, billed_to_customer: false, project_expense_notes_template: null,
        },
        error: null,
      },
    });
    grant(supabase);
    const res = await post({ template_id: "tpl-1", recurrence_key: "2026-11", expense_date: "2026-11-10", reason: "הפוליסה הסתיימה" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "exp-new" });
    const [row] = supabase.calls.insert.expenses as Array<Record<string, unknown>>;
    expect(row).toMatchObject({
      expense_date: "2026-11-10",
      amount: 0,
      paid_amount: 0,
      payment_status: "paid",
      paid_date: "2026-11-10",
      category: "ביטוח",
      business_domain: "home",
      account_id: "acc-home",
      recurring_expense_template_id: "tpl-1",
      recurrence_key: "2026-11",
      notes: "בוטל – הפוליסה הסתיימה",
      recorded_by: "prof-1",
    });
    expect(supabase.calls.insert.project_expenses).toBeUndefined();
  });
});

describe("POST /api/recurring-expenses/cancel-month — putting a month back", () => {
  it("removes the cancelled row and lets the template's backfill create the month again", async () => {
    const supabase = sb({ expenses: { data: { ...unpaidMonth, payment_status: "paid", amount: 0 }, error: null } });
    grant(supabase);
    const res = await post({ expense_id: "exp-8", restore: true });
    expect(res.status).toBe(200);
    expect(supabase.calls.delete.expenses).toBe(1);
    expect(supabase.calls.delete.project_expenses).toBe(1);
    expect(supabase.rpc).toHaveBeenCalledWith("backfill_recurring_expense", { p_template_id: "tpl-1" });
  });

  it("refuses to 'restore' a month that isn't cancelled — that would delete a real bill", async () => {
    for (const month of [unpaidMonth, { ...unpaidMonth, payment_status: "paid", amount: 310.28 }]) {
      const supabase = sb({ expenses: { data: month, error: null } });
      grant(supabase);
      const res = await post({ expense_id: "exp-8", restore: true });
      expect(res.status).toBe(409);
      expect(supabase.calls.delete.expenses).toBeUndefined();
      expect(supabase.rpc).not.toHaveBeenCalled();
    }
  });
});
