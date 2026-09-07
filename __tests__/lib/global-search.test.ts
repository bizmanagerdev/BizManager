import { describe, it, expect } from "vitest";
import {
  customerResult,
  projectResult,
  taskResult,
  orderResult,
  productResult,
  documentResult,
  propertyResult,
  paymentResult,
  expenseResult,
  contactResult,
  tagResult,
  userResult,
} from "@/lib/global-search";

// Each *Result builder maps one search row to a GlobalSearchResult, and its
// `href` is what the user lands on when they click it — the topbar quick
// search and the full /search page both render these directly. Several of
// these hrefs were previously wrong (a filtered list, a re-run text search, a
// bare list with the id dropped) even though the result already carried
// everything needed to link straight to the record; these tests lock in the
// fix and guard against it regressing.

describe("customerResult", () => {
  it("links to the customer's own detail page", () => {
    const r = customerResult({ id: "cust-1", customer_name: "ביאן מרקט", phone: "050-1234567" });
    expect(r?.href).toBe("/customers/cust-1");
    expect(r?.title).toBe("ביאן מרקט");
  });
  it("returns null with no id or no name", () => {
    expect(customerResult({ id: "cust-1" })).toBeNull();
    expect(customerResult({ customer_name: "X" })).toBeNull();
  });
});

describe("projectResult", () => {
  it("links to the project's own detail page", () => {
    const r = projectResult({ id: "proj-1", name: "מעבר דירה" });
    expect(r?.href).toBe("/projects/proj-1");
  });
});

describe("taskResult", () => {
  it("links to the task board with the task id (opens the card dialog)", () => {
    const r = taskResult({ id: "task-1", subject: "לתאם הובלה" });
    expect(r?.href).toBe("/tasks/task-1");
  });
});

describe("orderResult", () => {
  it("links to the order's own detail page", () => {
    const r = orderResult({ id: "order-1", customer_name: "יעקב הלר" });
    expect(r?.href).toBe("/sales/orders/order-1");
  });
});

describe("productResult", () => {
  it("focuses the specific product row on the inventory list (was a bare list link)", () => {
    const r = productResult({ id: "prod-1", name: "ארגז הובלה" });
    expect(r?.href).toBe("/sales?tab=inventory&focus=prod-1");
  });
});

describe("documentResult", () => {
  it("opens the matched document's own preview dialog (was re-running a text search)", () => {
    const r = documentResult({ id: "doc-1", title: "חשבונית 123" });
    expect(r?.href).toBe("/documents?focus=doc-1");
  });
});

describe("propertyResult", () => {
  it("links to the property's own detail page (was the bare list)", () => {
    const r = propertyResult({ id: "prop-1", address: "הרצל 1" });
    expect(r?.href).toBe("/properties/prop-1");
  });
});

describe("paymentResult", () => {
  it("focuses the specific payment on the financial ledger (was a coarse type/domain filter)", () => {
    const r = paymentResult({ id: "pay-1", amount_total: 500 });
    expect(r?.href).toBe(`/financial?focus=${encodeURIComponent("payment:pay-1")}`);
  });
});

describe("expenseResult", () => {
  it("focuses the specific expense on the financial ledger (was a coarse type/domain filter)", () => {
    const r = expenseResult({ id: "exp-1", amount: 300 });
    expect(r?.href).toBe(`/financial?focus=${encodeURIComponent("expense:exp-1")}`);
  });
});

describe("contactResult", () => {
  it("links to the parent customer (a contact has no page of its own)", () => {
    const r = contactResult(
      { id: "contact-1", customer_id: "cust-1", full_name: "דנה" },
      new Map([["cust-1", "ביאן מרקט"]])
    );
    expect(r?.href).toBe("/customers/cust-1");
    expect(r?.subtitle).toBe("ביאן מרקט");
  });
});

describe("tagResult", () => {
  it("a vehicle-kind tag links to its own vehicle page", () => {
    const r = tagResult({ id: "tag-1", name: "12-345-67", kind: "vehicle" });
    expect(r?.href).toBe("/vehicles/tag-1");
  });
  it("a non-vehicle tag falls back to the vehicles list (no page of its own)", () => {
    const r = tagResult({ id: "tag-2", name: "קמפיין קיץ", kind: "campaign" });
    expect(r?.href).toBe("/vehicles");
  });
});

describe("userResult", () => {
  it("links to the worker's profile page", () => {
    const r = userResult({ id: "user-1", full_name: "יעקב הלר" });
    expect(r?.href).toBe("/payroll/workers/user-1");
  });
});
