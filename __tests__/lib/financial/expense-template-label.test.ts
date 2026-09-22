import { describe, it, expect } from "vitest";
import { buildExpenseEntries } from "@/lib/financial/entries";
import type { ExpenseRow } from "@/lib/financial/types";

// A row generated from a recurring template is labelled by the template's NAME
// (what the הוצאות קבועות list and the payments calendar show), and the ledger
// search finds it by that name as well as by its own description.

const base = {
  projectsById: new Map(),
  ordersById: new Map(),
  propertiesById: new Map(),
  propertyCustomersById: new Map(),
  projectExpenseLinksByExpenseId: new Map<string, string>(),
  recordedByNames: {},
  customerId: null,
  customerProjectSet: new Set<string>(),
  referenceDate: "2026-09-15",
};

function row(over: Partial<ExpenseRow>): ExpenseRow {
  return {
    id: "e1",
    expense_date: "2026-06-20",
    amount: 4365,
    category: "רכישה",
    description: null,
    business_domain: "property_management",
    payment_status: "paid",
    ...over,
  } as ExpenseRow;
}

describe("buildExpenseEntries — template name as the label", () => {
  const names = new Map([["tpl-2", { name: "הלוואה אמא 2", variable: false }]]);
  const variable = new Map([["tpl-v", { name: "משכנתא", variable: true }]]);

  it("labels a generated row that has no description by its template name, and makes it searchable", () => {
    const [entry] = buildExpenseEntries({ ...base, expenseRows: [row({ recurring_expense_template_id: "tpl-2" })], templateMetaById: names });
    expect(entry.description).toBe("הלוואה אמא 2");
    expect(entry.searchText).toContain("אמא");
    expect(entry.expenseDescriptionRaw).toBeNull();
  });

  it("prefers the template name over the row's own description, but keeps the description searchable and raw", () => {
    const [entry] = buildExpenseEntries({
      ...base,
      expenseRows: [row({ recurring_expense_template_id: "tpl-2", description: "תשלום חודשי" })],
      templateMetaById: names,
    });
    expect(entry.description).toBe("הלוואה אמא 2");
    expect(entry.searchText).toContain("תשלום חודשי");
    expect(entry.expenseDescriptionRaw).toBe("תשלום חודשי");
  });

  it("falls back to the usual description chain when there is no template or no name for it", () => {
    const [plain] = buildExpenseEntries({ ...base, expenseRows: [row({})], templateMetaById: names });
    expect(plain.description).toBe("רכישה");
    const [unknownTpl] = buildExpenseEntries({ ...base, expenseRows: [row({ recurring_expense_template_id: "tpl-x" })], templateMetaById: names });
    expect(unknownTpl.description).toBe("רכישה");
    const [noMap] = buildExpenseEntries({ ...base, expenseRows: [row({ recurring_expense_template_id: "tpl-2" })] });
    expect(noMap.description).toBe("רכישה");
  });

  it("flags an unpaid row of a variable-amount template as an estimate — and not once it is paid", () => {
    const [pending] = buildExpenseEntries({
      ...base,
      expenseRows: [row({ recurring_expense_template_id: "tpl-v", payment_status: "not_paid" })],
      templateMetaById: variable,
    });
    expect(pending.expenseVariableEstimate).toBe(true);
    const [paid] = buildExpenseEntries({
      ...base,
      expenseRows: [row({ recurring_expense_template_id: "tpl-v", payment_status: "paid" })],
      templateMetaById: variable,
    });
    expect(paid.expenseVariableEstimate).toBe(false);
    const [fixed] = buildExpenseEntries({ ...base, expenseRows: [row({ recurring_expense_template_id: "tpl-2", payment_status: "not_paid" })], templateMetaById: names });
    expect(fixed.expenseVariableEstimate).toBe(false);
  });
});

// ─── Who entered it ──────────────────────────────────────────────────────────
// The generator stamps the TEMPLATE's author on every bill it creates, so the
// ledger used to say that person entered a payment they never touched.

describe("buildExpenseEntries — a generated bill has no person behind it", () => {
  const template = new Map([["tpl-2", { name: "ארנונה", variable: false, createdBy: "u-author" }]]);
  const names = { "u-author": "מנהל המשרד", "u-other": "עובד" };

  it("drops the name when the stamp is the template's author, and keeps it out of the search text", () => {
    const [entry] = buildExpenseEntries({
      ...base,
      recordedByNames: names,
      expenseRows: [row({ recurring_expense_template_id: "tpl-2", recorded_by: "u-author" })],
      templateMetaById: template,
    });
    expect(entry.recordedByName).toBeNull();
    expect(entry.searchText).not.toContain("מנהל המשרד");
  });

  it("keeps the person who marked an upcoming bill paid themselves", () => {
    const [entry] = buildExpenseEntries({
      ...base,
      recordedByNames: names,
      expenseRows: [row({ recurring_expense_template_id: "tpl-2", recorded_by: "u-other" })],
      templateMetaById: template,
    });
    expect(entry.recordedByName).toBe("עובד");
  });

  it("leaves an ordinary expense alone", () => {
    const [entry] = buildExpenseEntries({
      ...base,
      recordedByNames: names,
      expenseRows: [row({ recorded_by: "u-author" })],
      templateMetaById: template,
    });
    expect(entry.recordedByName).toBe("מנהל המשרד");
  });
});

