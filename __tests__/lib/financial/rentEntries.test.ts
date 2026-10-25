import { describe, expect, it } from "vitest";

// Rent in the books (owner, 2026-10-25: "rent comes in as part of the big
// cycle every month of money coming in and going out. It for sure should be
// in the customer's open debt"), by the rent page's own rule:
//  - a month still owed is open debt, like an order's — less what a check we
//    hold for it stands for (the check is its own payment entry);
//  - a rent payment is its tenant's alone — not everyone who ever rented there;
//  - "הרווחתי": each lease's rent earned in the month it falls due, paid or not;
//  - the payments calendar shows rent month by month itself — not the ledger's
//    rent debt again.

import { aggregateProfitLoss, buildPaymentEntries, buildRentReceivableEntries } from "@/lib/financial/entries";
import { rentDueMonths } from "@/lib/rent-roll";
import { loadIncomeCalendarItems } from "@/lib/receivables-load";
import type { FinancialEntry, PaymentRow } from "@/lib/financial/types";
import type { LeaseAgreement } from "@/lib/properties";

const LEASES = [
  { id: "l1", propertyId: "prop1", customerId: "c1", customerName: "רוזנפלד", unitLabel: null },
  { id: "l2", propertyId: "prop1", customerId: "c2", customerName: "לוי", unitLabel: "מחסן 2" },
];
const DEBTS = new Map([
  [
    "l1",
    {
      months: [
        { period: "2026-09-01", owed: 4000, withCheck: 0 },
        // October's check is held past its day: it's its own payment entry — nothing more here.
        { period: "2026-10-01", owed: 4000, withCheck: 4000 },
      ],
    },
  ],
  ["l2", { months: [{ period: "2026-10-01", owed: 300, withCheck: 0 }] }],
]);
const rentArgs = (customerId: string | null = null) => ({
  leases: LEASES,
  debts: DEBTS,
  propertyNameById: new Map([["prop1", "D4 הר יונה"]]),
  periodLabel: (_leaseId: string, period: string) => (period === "2026-09-01" ? "ספטמבר" : "אוקטובר"),
  customerId,
  referenceDate: "2026-10-21",
});

describe("rent still owed, in the books", () => {
  it("one open debt per tenant's month, in the month it was due — a held check's month not twice", () => {
    const entries = buildRentReceivableEntries(rentArgs());
    expect(entries.map((e) => [e.id, e.amount, e.flowDate, e.stage, e.customerId, e.origin])).toEqual([
      ["rent-receivable:l1:2026-09-01", 4000, "2026-09-01", "pending", "c1", "rent_receivable"],
      ["rent-receivable:l2:2026-10-01", 300, "2026-10-01", "pending", "c2", "rent_receivable"],
    ]);
    expect(entries[0]).toMatchObject({
      type: "inflow",
      businessDomain: "property_management",
      description: "שכירות ספטמבר שלא שולמה — רוזנפלד",
      sourceLabel: "D4 הר יונה",
    });
    expect(entries[1].sourceLabel).toBe("D4 הר יונה · מחסן 2");
  });

  it("filtered to a customer: their months only", () => {
    expect(buildRentReceivableEntries(rentArgs("c2")).map((e) => e.id)).toEqual(["rent-receivable:l2:2026-10-01"]);
  });

  it("earned but not in: the month's accrual revenue, not its cash", () => {
    const rows = aggregateProfitLoss(buildRentReceivableEntries(rentArgs()) as FinancialEntry[]);
    const total = (key: "accrualRevenue" | "cashRevenue") => rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
    expect(total("accrualRevenue")).toBe(4300);
    expect(total("cashRevenue")).toBe(0);
  });
});

describe("a rent payment is its tenant's", () => {
  const rent: PaymentRow = {
    id: "pay-aug", payment_date: "2026-08-01", due_date: null, amount_total: 4000, payment_method: "bank_transfer",
    payment_status: "cleared", reference_number: null, business_domain: "property_management", notes: null,
    project_id: null, order_id: null, property_id: "prop1", target_type: null, target_id: null, recorded_by: null,
  };
  const args = (customerId: string | null) => ({
    paymentRows: [rent],
    projectsById: new Map(),
    ordersById: new Map(),
    propertiesById: new Map([["prop1", { id: "prop1", address: "הגפן 3" }]]),
    // Everyone who ever rented the property — what the filter used before.
    propertyCustomersById: new Map([["prop1", new Set(["c1", "c0"])]]),
    recordedByNames: {},
    customerId,
    customerProjectSet: new Set<string>(),
    referenceDate: "2026-10-21",
    tenantByPaymentId: new Map([["pay-aug", "c1"]]),
  });

  it("says its tenant, and shows for them — not for the earlier tenant", () => {
    expect(buildPaymentEntries(args(null))[0].customerId).toBe("c1");
    expect(buildPaymentEntries(args("c1"))).toHaveLength(1);
    expect(buildPaymentEntries(args("c0"))).toHaveLength(0);
  });
});

describe("הרווחתי: each lease's rent in its month", () => {
  const lease = (row: Partial<LeaseAgreement>) =>
    ({
      id: "l1", propertyId: "prop1", customerId: "c1", status: "active", startDate: "2026-08-01", endDate: null,
      monthlyRentAmount: 4000, rentDayOfMonth: null, rentCalendar: "gregorian", rentHebrewDay: null, periodMonths: 1,
      ...row,
    }) as LeaseAgreement;

  it("every month from its first, up to the end of this one — and to its end when it ended", () => {
    expect(rentDueMonths({ leases: [lease({})] }, "2026-10-31").map((m) => [m.period, m.amount])).toEqual([
      ["2026-08-01", 4000],
      ["2026-09-01", 4000],
      ["2026-10-01", 4000],
    ]);
    expect(rentDueMonths({ leases: [lease({ status: "ended", endDate: "2026-08-31" })] }, "2026-10-31")).toHaveLength(1);
    expect(rentDueMonths({ leases: [lease({ status: "cancelled" })] }, "2026-10-31")).toEqual([]);
  });
});

describe("the payments calendar", () => {
  it("leaves the ledger's rent debt out — it shows rent month by month itself", async () => {
    const throwing = { from: () => { throw new Error("no database here"); } } as never;
    const debt = buildRentReceivableEntries(rentArgs())[0];
    const items = await loadIncomeCalendarItems(throwing, {
      entries: [debt],
      referenceDate: "2026-10-21",
      fromIso: "2026-09-01",
      toIso: "2026-10-31",
    });
    expect(items.some((item) => item.id.includes("rent-receivable"))).toBe(false);
  });
});
