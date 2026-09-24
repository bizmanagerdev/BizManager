import { describe, it, expect } from "vitest";
import { SYSTEM_RULES } from "@/lib/reminders/system-rules";

// SYSTEM_RULES drives the inbox/dashboard/push worklist — each rule's
// evaluate() returns the "problems that currently exist", one url per item.
// Several of these urls used to drop an id the rule already had (customer,
// worker, expense) and land on a bare list instead — these tests exercise the
// evaluate() functions directly (bypassing the DB-upsert half of the engine,
// syncSystemReminders) against a fake Supabase client, and lock in the fix.

function rule(key: string) {
  const found = SYSTEM_RULES.find((r) => r.key === key);
  if (!found) throw new Error(`no system rule registered with key "${key}"`);
  return found;
}

function ctx(todayIso = "2026-09-07") {
  return {
    todayIso,
    nowIso: `${todayIso}T12:00:00.000Z`,
    today: new Date(`${todayIso}T00:00:00.000Z`),
    nearHorizonIso: todayIso,
  };
}

type TableResponse = { data?: unknown[] | null; error?: { message: string } | null };

// A minimal chainable query-builder stand-in: every filter method (.eq/.not/
// .lt/.lte/.gt/.in/.order/...) just returns itself, and the chain resolves
// to the canned response for that table when awaited — same shape the rest
// of this app's route tests already use (see __tests__/api/expenses-create).
function makeSupabase(responses: Record<string, TableResponse>) {
  const from = (table: string) => {
    const resp: TableResponse = responses[table] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "lt", "lte", "gt", "gte", "in", "order", "range", "limit"]) {
      builder[m] = () => builder;
    }
    builder.then = (onF: (v: TableResponse) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from } as unknown as Parameters<(typeof SYSTEM_RULES)[number]["evaluate"]>[0];
}

describe("check_deposit_due", () => {
  it("focuses the specific check on the checks register (was a bare /checks link)", async () => {
    const supabase = makeSupabase({
      payments: {
        data: [
          {
            id: "pay-1",
            check_number: "1042",
            amount_total: 1500,
            due_date: "2026-09-01",
            payment_status: "pending",
            order_id: "order-1",
            project_id: null,
          },
        ],
      },
    });
    const items = await rule("check_deposit_due").evaluate(supabase, ctx());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("/checks?focus=pay-1");
    expect(items[0].links).toEqual({ payment_id: "pay-1", order_id: "order-1", project_id: null });
  });
});

describe("promise_broken", () => {
  it("focuses the specific customer on the collections page (was a bare /collections?view=debtors link)", async () => {
    const supabase = makeSupabase({
      payment_promises: {
        data: [
          {
            id: "promise-1",
            customer_id: "cust-1",
            amount: 800,
            promised_date: "2026-09-01",
            order_id: "order-2",
            project_id: null,
          },
        ],
      },
      customers: { data: [{ id: "cust-1", name: "ביאן מרקט" }] },
    });
    const items = await rule("promise_broken").evaluate(supabase, ctx());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("/collections?focus=cust-1");
    expect(items[0].title).toContain("ביאן מרקט");
  });

  it("falls back to the bare list only when there's genuinely no customer id", async () => {
    const supabase = makeSupabase({
      payment_promises: {
        data: [{ id: "promise-2", customer_id: null, amount: 200, promised_date: "2026-09-01" }],
      },
      customers: { data: [] },
    });
    const items = await rule("promise_broken").evaluate(supabase, ctx());
    expect(items[0].url).toBe("/collections");
  });
});

describe("wage_overdue", () => {
  it("links to the specific worker's profile (was a bare /payroll link)", async () => {
    const supabase = makeSupabase({
      worker_debt_items_view: {
        data: [
          {
            user_id: "user-1",
            source_date: "2026-07-01",
            due_date: "2026-08-10",
            owed_amount: 3000,
            source_type: "payslip",
          },
        ],
      },
      users: { data: [{ id: "user-1", full_name: "יעקב הלר" }] },
    });
    const items = await rule("wage_overdue").evaluate(supabase, ctx());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("/payroll/workers/user-1");
    expect(items[0].title).toContain("יעקב הלר");
  });
});

describe("recurring_expense_confirm", () => {
  it("opens the expense's own edit dialog on /financial (was a bare /financial link)", async () => {
    const supabase = makeSupabase({
      expenses: {
        data: [
          {
            id: "exp-1",
            expense_date: "2026-09-01",
            payment_status: "not_paid",
            recurring_expense_template_id: "tpl-1",
          },
        ],
      },
    });
    const items = await rule("recurring_expense_confirm").evaluate(supabase, ctx());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe(`/financial?focus=${encodeURIComponent("expense:exp-1")}`);
  });
});

describe("מקורות נוספים heads-ups — work days before a salary / loan instalment / card charge", () => {
  // Calendar for these cases: 2026-09-05 is a Saturday, 2026-09-10 a Thursday.
  const charges = [
    { id: "c1", statement_id: "s1", card_label: "ויזה 9557", account_id: "acc1", amount: 1000, charge_date: "2026-08-05", notes: null },
  ];

  it("card: fires 3 WORK days before the usual day by default — Sat 05/09 minus 3 work days = Tue 01/09", async () => {
    const sb = () => makeSupabase({ card_statement_charges: { data: charges } });
    const on = await rule("card_charge_upcoming").evaluate(sb(), ctx("2026-09-01"));
    expect(on).toHaveLength(1);
    expect(on[0].key).toBe("ccharge_proj:ויזה 9557:2026-09");
    expect(on[0].title).toContain("ויזה 9557");
    expect(on[0].content).not.toMatch(/₪/); // a forecast carries no amount
    expect(on[0].url).toBe("/financial/payments-calendar?focus=ccharge_proj%3A%D7%95%D7%99%D7%96%D7%94%209557%3A2026-09&month=2026-09");
    expect(on[0].behavior).toBe("ping_once");
    expect(await rule("card_charge_upcoming").evaluate(sb(), ctx("2026-08-31"))).toEqual([]);
    expect(await rule("card_charge_upcoming").evaluate(sb(), ctx("2026-09-06"))).toEqual([]);
  });

  it("card: a stored setting overrides the default (1 work day → from Thu 03/09 only)", async () => {
    const sb = () =>
      makeSupabase({
        card_statement_charges: { data: charges },
        outflow_source_settings: { data: [{ source_kind: "card", source_key: "ויזה 9557", reminder_work_days_before: 1, account_id: null }] },
      });
    expect(await rule("card_charge_upcoming").evaluate(sb(), ctx("2026-09-02"))).toEqual([]);
    expect(await rule("card_charge_upcoming").evaluate(sb(), ctx("2026-09-03"))).toHaveLength(1);
  });

  it("card: a REAL recorded future charge is alerted with its amount", async () => {
    const items = await rule("card_charge_upcoming").evaluate(
      makeSupabase({ card_statement_charges: { data: [{ ...charges[0], charge_date: "2026-09-10" }] } }),
      ctx("2026-09-08")
    );
    expect(items.map((i) => i.key)).toEqual(["ccharge:c1"]);
    expect(items[0].content).toContain("1,000");
  });

  it("salary: opt-in — nothing without a setting; with 2 work days before Thu 10/09 it fires from Tue 08/09", async () => {
    const tables = {
      salary_agreements: { data: [{ id: "a1", user_id: "u1", salary_type: "monthly", monthly_salary: 8000, valid_from: "2026-01-01", valid_to: null, due_day_of_next_month: 10 }] },
      users: { data: [{ id: "u1", full_name: "דוד", email: null, active: true }] },
    };
    expect(await rule("salary_payment_reminder").evaluate(makeSupabase(tables), ctx("2026-09-08"))).toEqual([]);
    const withSetting = () =>
      makeSupabase({
        ...tables,
        outflow_source_settings: { data: [{ source_kind: "salary", source_key: "u1", reminder_work_days_before: 2, account_id: null }] },
      });
    expect(await rule("salary_payment_reminder").evaluate(withSetting(), ctx("2026-09-07"))).toEqual([]);
    const on = await rule("salary_payment_reminder").evaluate(withSetting(), ctx("2026-09-08"));
    expect(on).toHaveLength(1);
    expect(on[0].key).toBe("salary_proj:u1:2026-09");
    expect(on[0].title).toContain("דוד");
    expect(on[0].content).toContain("8,000");
    expect(on[0].url).toContain("month=2026-09");
  });

  it("salary: stays quiet once this month's salary was paid, and when the source is switched off", async () => {
    const tables = {
      salary_agreements: { data: [{ id: "a1", user_id: "u1", salary_type: "monthly", monthly_salary: 8000, valid_from: "2026-01-01", valid_to: null, due_day_of_next_month: 10 }] },
      users: { data: [{ id: "u1", full_name: "דוד", email: null, active: true }] },
    };
    const paid = await rule("salary_payment_reminder").evaluate(
      makeSupabase({
        ...tables,
        outflow_source_settings: { data: [{ source_kind: "salary", source_key: "u1", reminder_work_days_before: 2, account_id: null }] },
        worker_payments: { data: [{ user_id: "u1", payment_date: "2026-09-08" }] },
      }),
      ctx("2026-09-08")
    );
    expect(paid).toEqual([]);
    const off = await rule("salary_payment_reminder").evaluate(
      makeSupabase({
        ...tables,
        outflow_source_settings: { data: [{ source_kind: "salary", source_key: "u1", reminder_work_days_before: 2, account_id: null, is_active: false }] },
      }),
      ctx("2026-09-08")
    );
    expect(off).toEqual([]);
  });

  it("loan: the next planned instalment of a loan the business repays", async () => {
    const sb = () =>
      makeSupabase({
        loans: {
          data: [{ id: "L1", direction: "taken", lender: "בנק", borrower: null, loan_date: "2026-01-01", loan_method: null, repayment_method: null, documentation: null, amount: 10000, due_date: null, interest_amount: 0, business_domain: "general_business", counterparty_customer_id: null, status: "active", notes: null, account_id: null, created_at: null }],
        },
        loan_repayments: {
          data: [{ id: "r1", loan_id: "L1", repayment_date: "2026-09-10", amount: 1000, interest_amount: 0, method: null, account_id: null, notes: null, created_at: null, status: "planned", installment_index: 1, installment_count: 10 }],
        },
        outflow_source_settings: { data: [{ source_kind: "loan", source_key: "L1", reminder_work_days_before: 2, account_id: null }] },
      });
    expect(await rule("loan_installment_reminder").evaluate(sb(), ctx("2026-09-07"))).toEqual([]);
    const on = await rule("loan_installment_reminder").evaluate(sb(), ctx("2026-09-08"));
    expect(on).toHaveLength(1);
    expect(on[0].key).toBe("loan_planned:r1");
    expect(on[0].title).toContain("בנק");
    expect(on[0].content).toContain("1,000");
  });
});

describe("recurring_payment_reminder — a period already paid stops nagging", () => {
  const template = {
    id: "t1", template_name: "ארנונה", category: "מיסים", amount: 500, is_variable_amount: false,
    frequency: "monthly", interval_months: 1, expense_day_of_month: 10, expense_month_of_year: null,
    start_date: "2026-01-10", created_at: "2026-01-01T00:00:00Z", reminder_work_days_before: 2,
  };

  it("fires 2 work days before Thu 10/09 (from Tue 08/09) while the period is unpaid", async () => {
    const items = await rule("recurring_payment_reminder").evaluate(
      makeSupabase({ recurring_expense_templates: { data: [template] } }),
      ctx("2026-09-08")
    );
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("t1:2026-09");
    expect(items[0].url).toContain("recur_proj%3At1%3A2026-09");
  });

  it("stays quiet once that period's row is paid (paid early, or a standing order that landed)", async () => {
    const items = await rule("recurring_payment_reminder").evaluate(
      makeSupabase({
        recurring_expense_templates: { data: [template] },
        expenses: { data: [{ recurring_expense_template_id: "t1", recurrence_key: "2026-09" }] },
      }),
      ctx("2026-09-08")
    );
    expect(items).toEqual([]);
  });
});

describe("document_expiry", () => {
  // The fake returns [] for document_categories, so the rule falls back to the
  // seeded registry — ביטוח / תעודה-רישיון / חוזה-הסכם, 30-day lead.
  const docs = (rows: Record<string, unknown>[]) =>
    makeSupabase({ documents: { data: rows, error: null } });

  it("flags an already-expired document as danger and focuses it", async () => {
    const items = await rule("document_expiry").evaluate(
      docs([
        {
          id: "doc-1",
          title: "פוליסת ביטוח רכב",
          document_type: "ביטוח",
          valid_until: "2026-08-01",
        },
      ]),
      ctx("2026-09-07")
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "doc-1",
      severity: "danger",
      url: "/documents?focus=doc-1",
      audienceRole: "office",
    });
    expect(items[0]?.title).toContain("פוליסת ביטוח רכב");
    expect(items[0]?.content).toContain("פג");
  });

  it("stays quiet about a policy a newer one has replaced", async () => {
    // Uploading this year's insurance should not leave last year's shouting
    // from the inbox forever. Both hang off the same vehicle tag, so the later
    // date makes the earlier one history rather than a job.
    const supabase = makeSupabase({
      documents: {
        data: [
          { id: "old", title: "ביטוח 2025", document_type: "ביטוח", valid_until: "2026-08-01" },
          { id: "new", title: "ביטוח 2026", document_type: "ביטוח", valid_until: "2027-08-01" },
        ],
        error: null,
      },
      entity_tags: {
        data: [
          { entity_id: "old", tag_id: "veh-1", tags: { kind: "vehicle" } },
          { entity_id: "new", tag_id: "veh-1", tags: { kind: "vehicle" } },
        ],
        error: null,
      },
    });
    const items = await rule("document_expiry").evaluate(supabase, ctx("2026-09-07"));
    expect(items).toEqual([]);
  });

  it("still flags an expired document when the newer one belongs to another vehicle", async () => {
    const supabase = makeSupabase({
      documents: {
        data: [
          { id: "old", title: "ביטוח רכב א", document_type: "ביטוח", valid_until: "2026-08-01" },
          { id: "new", title: "ביטוח רכב ב", document_type: "ביטוח", valid_until: "2027-08-01" },
        ],
        error: null,
      },
      entity_tags: {
        data: [
          { entity_id: "old", tag_id: "veh-1", tags: { kind: "vehicle" } },
          { entity_id: "new", tag_id: "veh-2", tags: { kind: "vehicle" } },
        ],
        error: null,
      },
    });
    const items = await rule("document_expiry").evaluate(supabase, ctx("2026-09-07"));
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe("old");
  });

  it("warns while the document is still valid but inside the lead window", async () => {
    const items = await rule("document_expiry").evaluate(
      docs([
        { id: "doc-2", title: "רישיון עסק", document_type: "תעודה/רישיון", valid_until: "2026-09-20" },
      ]),
      ctx("2026-09-07")
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.severity).toBe("warning");
    expect(items[0]?.content).toContain("יפוג");
  });

  it("stays quiet about a document whose expiry is beyond its lead window", async () => {
    // 2026-12-01 is ~85 days out; the seeded lead is 30.
    const items = await rule("document_expiry").evaluate(
      docs([{ id: "doc-3", document_type: "ביטוח", valid_until: "2026-12-01" }]),
      ctx("2026-09-07")
    );
    expect(items).toEqual([]);
  });

  it("falls back to the file name when the document has no title", async () => {
    const items = await rule("document_expiry").evaluate(
      docs([
        { id: "doc-4", title: null, file_name: "bituach.pdf", document_type: "ביטוח", valid_until: "2026-09-01" },
      ]),
      ctx("2026-09-07")
    );
    expect(items[0]?.title).toContain("bituach.pdf");
  });

  it("returns nothing instead of throwing when valid_until does not exist yet", async () => {
    // Pre-migration: the whole sync must keep working, the same way
    // vehicle_expiry tolerates a missing vehicles table.
    const items = await rule("document_expiry").evaluate(
      makeSupabase({
        documents: { data: null, error: { message: 'column documents.valid_until does not exist' } },
      }),
      ctx("2026-09-07")
    );
    expect(items).toEqual([]);
  });

  it("ignores a document with no expiry date at all", async () => {
    const items = await rule("document_expiry").evaluate(
      docs([{ id: "doc-5", document_type: "ביטוח", valid_until: null }]),
      ctx("2026-09-07")
    );
    expect(items).toEqual([]);
  });
});
