import { describe, expect, it } from "vitest";
import {
  buildOrderRows,
  buildProjectRows,
  compareDocumentsNewestFirst,
  comparePaymentsNewestFirst,
  customerDeleteBlocker,
  joinHebrewAnd,
  lastClearedPaymentAt,
  ordersHe,
  projectsHe,
  summarizeCustomerMoney,
  type CustomerPaymentRow,
} from "@/app/(app)/customers/[id]/customerPageModel";
import type { CustomerReceivable } from "@/lib/collections";

// The customer page's figures and words, worked out once on the server
// (customerPageModel.ts). The money is the page's as it always was — moved, not
// changed — so these pin its formula: orders from order_overview_view, projects
// by the collection split, lateness from the receivables.

function receivable(overrides: Partial<CustomerReceivable>): CustomerReceivable {
  return {
    source_type: "order",
    source_id: "o1",
    collection_key: "order:o1",
    title: null,
    business_domain: null,
    reference_date: null,
    total_amount: 0,
    collected_amount: 0,
    outstanding_amount: 0,
    pending_amount: 0,
    overdue_amount: 0,
    next_due_date: null,
    due_date: null,
    payment_terms: null,
    days_late: 0,
    collection_status: "unpaid",
    pending_payments: [],
    ...overrides,
  };
}

function payment(id: string, date: string | null, status = "cleared"): CustomerPaymentRow {
  return { id, date, method: null, status, dueDate: null, checkNumber: null, amount: 1, source: null };
}

describe("the money summary", () => {
  const orders = buildOrderRows([
    { order_id: "o1", order_date: "2026-09-01", status: "delivered", total_amount: 1000, collected_amount: 400, pending_amount: 100, overdue_amount: 50, remaining_balance: 600, payment_count: 2 },
    { order_id: "o2", order_date: "2026-10-01", status: "draft", total_amount: "500", collected_amount: 500, pending_amount: 0, overdue_amount: 0, remaining_balance: 0, payment_count: 1 },
  ]);

  it("sums the orders as the orders list states them", () => {
    expect(orders[1]).toEqual({
      id: "o2",
      date: "2026-10-01",
      status: "draft",
      total: 500,
      collected: 500,
      pending: 0,
      overdue: 0,
      remaining: 0,
      paymentCount: 1,
    });
    const money = summarizeCustomerMoney({ orders, projects: [], receivables: [] });
    expect(money).toMatchObject({
      totalSales: 1500,
      totalPaid: 900,
      totalExpected: 100,
      totalOverdueExpected: 50,
      openBalance: 600,
      paidPct: 60,
      lastOrderAt: "2026-10-01",
    });
  });

  it("prices a project at the higher of the view's price and its own VAT-grossed base, collected by the split", () => {
    const projects = buildProjectRows(
      [
        { id: "p1", name: "שיפוץ", status: "active", start_date: "2026-08-01", agreed_base_price: 1000, actual_price: 0, price_includes_vat: true, vat_rate: 0.18 },
        { id: "p2", name: "", status: "planned", start_date: null, agreed_base_price: 0, actual_price: 300, price_includes_vat: false, vat_rate: null },
      ],
      [
        { id: "p1", customer_total_price: 1000, expenses_billed: 100 },
        { id: "p2", customer_total_price: 900, expenses_billed: 0 },
      ],
      [
        { id: "x1", project_id: "p1", amount_total: 500, net_amount: null, payment_status: "cleared", due_date: null },
        { id: "x2", project_id: "p1", amount_total: 200, net_amount: null, payment_status: "pending", due_date: "2099-01-01" },
      ]
    );
    // 1000 × 1.18 + 100 billed = 1280 beats the view's 1000; p2 takes the view's 900.
    expect(projects.map((p) => p.totalPrice)).toEqual([1280, 900]);
    expect(projects[0]).toMatchObject({ collected: 500, pending: 200, name: "שיפוץ", startDate: "2026-08-01" });
    expect(projects[1]).toMatchObject({ name: "פרויקט", startDate: null, collected: 0 });

    const money = summarizeCustomerMoney({ orders: [], projects, receivables: [] });
    expect(money.totalSales).toBe(2180);
    expect(money.totalPaid).toBe(500);
    expect(money.openBalance).toBe(1680);
    expect(money.totalExpected).toBe(200);
  });

  it("never states a negative debt", () => {
    const overpaid = buildOrderRows([{ order_id: "o", total_amount: 100, collected_amount: 150 }]);
    expect(summarizeCustomerMoney({ orders: overpaid, projects: [], receivables: [] }).openBalance).toBe(0);
    expect(summarizeCustomerMoney({ orders: [], projects: [], receivables: [] }).paidPct).toBe(0);
  });

  it("takes the worst lateness with its terms, and the earliest due date, from the receivables", () => {
    const money = summarizeCustomerMoney({
      orders: [],
      projects: [],
      receivables: [
        receivable({ days_late: 3, payment_terms: "net_30", due_date: "2026-10-05" }),
        receivable({ days_late: 12, payment_terms: "net_60", next_due_date: "2026-09-20" }),
        receivable({ days_late: 0, payment_terms: null, due_date: "2026-11-01" }),
      ],
    });
    expect(money.maxDaysLate).toBe(12);
    expect(money.terms).toBe("net_60");
    expect(money.dueDate).toBe("2026-09-20");
  });
});

describe("the page's lists keep one order", () => {
  it("payments newest first, the id deciding between two on the same day", () => {
    const rows = [payment("a", "2026-10-01"), payment("c", "2026-10-02"), payment("b", "2026-10-01"), payment("z", null)];
    expect(rows.sort(comparePaymentsNewestFirst).map((p) => p.id)).toEqual(["c", "b", "a", "z"]);
  });

  it("documents newest first, undated last", () => {
    const docs = [
      { id: "1", uploadedAt: null },
      { id: "2", uploadedAt: "2026-10-01T10:00:00Z" },
      { id: "3", uploadedAt: "2026-10-02T10:00:00Z" },
      { id: "4", uploadedAt: "2026-10-01T10:00:00Z" },
    ];
    expect(docs.sort(compareDocumentsNewestFirst).map((d) => d.id)).toEqual(["3", "4", "2", "1"]);
  });

  it("the last activity is the newest payment that actually came in", () => {
    expect(
      lastClearedPaymentAt([payment("a", "2026-10-10", "pending"), payment("b", "2026-10-05"), payment("c", "2026-10-11", "rejected")])
    ).toBe("2026-10-05");
    expect(lastClearedPaymentAt([])).toBeNull();
  });
});

describe("counted words", () => {
  it("says one and two the Hebrew way", () => {
    expect(ordersHe(1)).toBe("הזמנה אחת");
    expect(ordersHe(2)).toBe("2 הזמנות");
    expect(ordersHe(6)).toBe("6 הזמנות");
    expect(projectsHe(1)).toBe("פרויקט אחד");
  });

  it("joins with 'and' stuck to the word, a hyphen before a numeral", () => {
    expect(joinHebrewAnd(["6 הזמנות", "2 פרויקטים"])).toBe("6 הזמנות ו-2 פרויקטים");
    expect(joinHebrewAnd(["הזמנה אחת", "פרויקט אחד"])).toBe("הזמנה אחת ופרויקט אחד");
    expect(joinHebrewAnd(["א", "ב", "3 ג"])).toBe("א, ב ו-3 ג");
    expect(joinHebrewAnd(["רק"])).toBe("רק");
    expect(joinHebrewAnd([])).toBe("");
  });
});

describe("what stops a delete", () => {
  it("names every foreign key the database refuses a delete for", () => {
    expect(customerDeleteBlocker({ orders: 6, projects: 2, leases: 0, morningDocuments: 0 })).toBe(
      "יש ללקוח 6 הזמנות ו-2 פרויקטים"
    );
    expect(customerDeleteBlocker({ orders: 0, projects: 0, leases: 1, morningDocuments: 0 })).toBe(
      "יש ללקוח חוזה שכירות אחד"
    );
    expect(customerDeleteBlocker({ orders: 1, projects: 0, leases: 0, morningDocuments: 3 })).toBe(
      "יש ללקוח הזמנה אחת ו-3 מסמכי Morning"
    );
  });

  it("lets a customer with nothing linked go", () => {
    expect(customerDeleteBlocker({ orders: 0, projects: 0, leases: 0, morningDocuments: 0 })).toBeNull();
  });
});
