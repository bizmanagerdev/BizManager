import { describe, it, expect } from "vitest";
import {
  GLOBAL_SEARCH_KINDS,
  buildGroups,
  formatReason,
  hrefFor,
  kindsForRole,
  toGlobalSearchResult,
} from "@/lib/global-search";

// Each result links to the record itself (owner: "global search should bring
// into customer or worker, not to the table"), and says why it came up.

type Row = Parameters<typeof toGlobalSearchResult>[0];

function row(partial: Partial<Row> & { kind: string; id: string }): Row {
  return { title: "x", subtitle: null, at: null, info: {}, reasons: [], rank: 3, total: 1, ...partial };
}

describe("hrefFor — every kind opens its own record", () => {
  it("customers, projects, orders, tasks open their own pages", () => {
    expect(hrefFor("customer", "c1", {}, "admin")).toBe("/customers/c1");
    expect(hrefFor("project", "p1", {}, "admin")).toBe("/projects/p1");
    expect(hrefFor("order", "o1", {}, "admin")).toBe("/sales/orders/o1");
    expect(hrefFor("task", "t1", {}, "admin")).toBe("/tasks/t1");
  });

  it("a contact opens its customer", () => {
    expect(hrefFor("contact", "k1", { customer_id: "c1" }, "admin")).toBe("/customers/c1");
  });

  it("money rows focus the row on the ledger for an admin", () => {
    expect(hrefFor("payment", "pay-1", {}, "admin")).toBe(`/financial?focus=${encodeURIComponent("payment:pay-1")}`);
    expect(hrefFor("expense", "exp-1", {}, "admin")).toBe(`/financial?focus=${encodeURIComponent("expense:exp-1")}`);
  });

  it("an income opens its order / project for office staff (the ledger is admin-only)", () => {
    expect(hrefFor("payment", "pay-1", { order_id: "o1" }, "office")).toBe("/sales/orders/o1");
    expect(hrefFor("payment", "pay-1", { project_id: "p1" }, "office")).toBe("/projects/p1");
    expect(hrefFor("payment", "pay-1", { method: "check" }, "office")).toBe("/checks?focus=pay-1");
  });

  it("worker records open the worker", () => {
    for (const kind of ["worker_payment", "shift", "absence", "salary", "payslip"] as const) {
      expect(hrefFor(kind, "x", { user_id: "u1" }, "admin")).toBe("/payroll/workers/u1");
    }
    expect(hrefFor("worker", "u1", {}, "admin")).toBe("/payroll/workers/u1");
  });

  it("a vehicle tag opens its car, other tags the list", () => {
    expect(hrefFor("vehicle", "tag-1", { kind: "vehicle" }, "admin")).toBe("/vehicles/tag-1");
    expect(hrefFor("vehicle", "tag-2", { kind: "general" }, "admin")).toBe("/vehicles");
  });

  it("documents, products, communications, card lines focus their row", () => {
    expect(hrefFor("document", "d1", {}, "admin")).toBe("/documents?focus=d1");
    expect(hrefFor("product", "pr1", {}, "admin")).toBe("/sales?tab=inventory&focus=pr1");
    expect(hrefFor("communication", "cl1", {}, "admin")).toBe("/communications?focus=cl1");
    expect(hrefFor("card_row", "r1", { statement_id: "s1" }, "admin")).toBe("/financial/statements/s1?focus=r1");
  });

  it("loans, repayments, transfers, accounts", () => {
    expect(hrefFor("loan", "l1", {}, "admin")).toBe("/financial/loans/l1");
    expect(hrefFor("loan_repayment", "lr1", { loan_id: "l1" }, "admin")).toBe("/financial/loans/l1");
    expect(hrefFor("transfer", "tr1", { from_account_id: "a1" }, "admin")).toBe("/financial/bank?account=a1&focus=tr1");
    expect(hrefFor("account", "a1", {}, "admin")).toBe("/financial/bank?account=a1");
  });

  it("every kind has a link", () => {
    for (const kind of GLOBAL_SEARCH_KINDS) {
      expect(hrefFor(kind, "id-1", {}, "admin")).toMatch(/^\//);
    }
  });
});

describe("kindsForRole", () => {
  it("an admin searches everything", () => {
    expect(kindsForRole("admin")).toBeNull();
  });
  it("office staff don't get records whose page is admin-only", () => {
    const kinds = kindsForRole("office") ?? [];
    expect(kinds).toContain("customer");
    expect(kinds).toContain("payment");
    expect(kinds).not.toContain("expense");
    expect(kinds).not.toContain("loan");
    expect(kinds).not.toContain("transfer");
  });
});

describe("formatReason", () => {
  it("shows a matched date the way the app does", () => {
    expect(formatReason({ k: "date", l: "תאריך הוצאה", v: "2026-10-15" })).toEqual({
      kind: "date",
      label: "תאריך הוצאה",
      value: "15/10/26",
    });
  });
  it("shows a date range as from – to", () => {
    expect(formatReason({ k: "date", l: "פעיל בתאריך", v: "2026-10-14/2026-10-16" })?.value).toBe("14/10/26 – 16/10/26");
  });
  it("shows an amount in shekels", () => {
    expect(formatReason({ k: "amount", l: "סכום", v: "1000.00" })?.value).toBe("₪1,000");
  });
  it("drops an empty reason", () => {
    expect(formatReason({ k: "text", l: "הערה", v: "" })).toBeNull();
  });
});

describe("toGlobalSearchResult", () => {
  it("paints the amount chip that matched, and doesn't repeat it as a line", () => {
    const result = toGlobalSearchResult(
      row({
        kind: "expense",
        id: "e1",
        title: "חשמל",
        info: { amount: 1000, date: "2026-10-15T00:00:00+00:00", category: "חשמל" },
        reasons: [{ k: "amount", l: "סכום", v: "1000" }],
      }),
      "admin"
    );
    expect(result?.meta.find((item) => item.text === "₪1,000")?.hit).toBe(true);
    expect(result?.reasons).toEqual([]);
  });

  it("keeps a word reason (a branch, a reply) under the title", () => {
    const result = toGlobalSearchResult(
      row({ kind: "customer", id: "c1", title: "הלר אבא", reasons: [{ k: "text", l: "סניף", v: "אהל זופניק" }] }),
      "admin"
    );
    expect(result?.reasons).toEqual([{ kind: "text", label: "סניף", value: "אהל זופניק" }]);
  });

  it("an order's title carries its short number", () => {
    const result = toGlobalSearchResult(row({ kind: "order", id: "1a2b3c4d-0000", title: "סולם" }), "admin");
    expect(result?.title).toBe("סולם · #1a2b3c4d");
  });

  it("ignores a kind it doesn't know", () => {
    expect(toGlobalSearchResult(row({ kind: "nope", id: "x" }), "admin")).toBeNull();
  });
});

describe("buildGroups", () => {
  it("puts the best-matching group first, keeps each group's total", () => {
    const groups = buildGroups(
      [
        row({ kind: "expense", id: "e1", rank: 3, total: 15 }),
        row({ kind: "customer", id: "c1", rank: 0, total: 1 }),
      ],
      "admin"
    );
    expect(groups.map((group) => group.key)).toEqual(["customer", "expense"]);
    expect(groups[1].total).toBe(15);
  });
});
