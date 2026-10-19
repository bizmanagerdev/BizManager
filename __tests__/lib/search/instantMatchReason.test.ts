import { describe, it, expect } from "vitest";
import { customerMatchReason, orderInstantReason, projectInstantReason } from "@/lib/search/instantMatchReason";
import type { CustomerSearchIndexEntry } from "@/app/(app)/customers/loadCustomers";
import type { OrderSearchIndexEntry } from "@/app/(app)/sales/loadOrders";
import type { ProjectSearchIndexEntry } from "@/app/(app)/projects/loadProjects";

// A row the quick on-device search brought in says which field matched
// (owner, 2026-10-19: "it should paint whatever it found matching").

function customer(partial: Partial<CustomerSearchIndexEntry>): CustomerSearchIndexEntry {
  return {
    id: "c1",
    name: "ישיבת ברסלב",
    name_for_invoice: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    active: true,
    requires_prepayment: false,
    delivery_lat: null,
    delivery_lng: null,
    addr_city: null,
    addr_street: null,
    addr_house_number: null,
    addr_lat: null,
    addr_lng: null,
    addr_place_id: null,
    contacts: [],
    branches: [],
    ...partial,
  };
}

const order: OrderSearchIndexEntry = {
  id: "o1",
  customer_id: "c1",
  customer_name: "ישיבת ברסלב",
  branch_id: null,
  customer_branch_name: "אהל זופניק",
  status: "delivered",
  order_date: null,
  needs_invoice: null,
  invoice_sent_at: null,
};

describe("customerMatchReason", () => {
  it("the invoice name", () => {
    expect(customerMatchReason(customer({ name_for_invoice: "ברכת הנחל" }), "נחל")).toEqual([
      { kind: "text", label: "שם לחשבונית", value: "ברכת הנחל" },
    ]);
  });
  it("digits inside a phone number", () => {
    expect(customerMatchReason(customer({ phone: "050-632-3624" }), "23/6")).toEqual([
      { kind: "text", label: "טלפון", value: "050-632-3624" },
    ]);
  });
  it("a contact", () => {
    expect(
      customerMatchReason(customer({ contacts: [{ full_name: "יוסי כהן", phone: "0521112233", email: null, whatsapp: null }] }), "כהן")
    ).toEqual([{ kind: "text", label: "איש קשר", value: "יוסי כהן" }]);
  });
  it("nothing matched → nothing", () => {
    expect(customerMatchReason(customer({}), "zzz")).toEqual([]);
    expect(customerMatchReason(undefined, "כהן")).toEqual([]);
  });
});

describe("orderInstantReason", () => {
  it("its customer first, then its branch", () => {
    expect(orderInstantReason(order, customer({}), "ברסלב")).toEqual([{ kind: "text", label: "לקוח", value: "ישיבת ברסלב" }]);
    expect(orderInstantReason(order, customer({}), "זופניק")).toEqual([{ kind: "text", label: "סניף", value: "אהל זופניק" }]);
  });
});

describe("projectInstantReason", () => {
  const project: ProjectSearchIndexEntry = {
    id: "p1",
    name: "הובלה סמט",
    customer_id: "c1",
    customer_name: "ישיבת ברסלב",
    status: "active",
    project_type: "moving",
    start_date: null,
  };
  it("its own name needs no line (the title is painted)", () => {
    expect(projectInstantReason(project, customer({}), "סמט")).toEqual([]);
  });
  it("its customer, or its customer's details", () => {
    expect(projectInstantReason(project, customer({}), "ברסלב")).toEqual([{ kind: "text", label: "לקוח", value: "ישיבת ברסלב" }]);
    expect(projectInstantReason(project, customer({ email: "office@breslev.org" }), "breslev")).toEqual([
      { kind: "text", label: "אימייל", value: "office@breslev.org" },
    ]);
  });
});
