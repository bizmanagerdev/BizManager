// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// סיכום כספי of a property kept in C$ — the Canada buildings (owner,
// 2026-10-23: "I want the totals here to show the shekel, the dollar, and the
// Canadian … I need to see all three"): each movement at its own day's rate.

vi.mock("@/components/charts/CategoryDonut", () => ({ default: () => null }));

import PropertyMoneyCard from "@/app/(app)/properties/[id]/PropertyMoneyCard";
import type { PropertyExpense, PropertyPayment } from "@/lib/properties";
import type { RateTable } from "@/lib/fx/day-rates";

afterEach(cleanup);

const RATES: RateTable = {
  USD: { days: ["2025-11-10", "2026-10-22"], rates: [3.3, 3.1] },
  CAD: { days: ["2025-11-10", "2026-10-22"], rates: [2.4, 2.2] },
};

function expense(fields: Partial<PropertyExpense>): PropertyExpense {
  return {
    id: "e1",
    date: "2025-11-10",
    amount: 0,
    category: "רכישה",
    description: null,
    paymentStatus: "paid",
    businessDomain: "property_management",
    notes: null,
    paymentMethod: null,
    accountId: null,
    paidAmount: null,
    projectId: null,
    orderId: null,
    propertyId: "pierre",
    recurringTemplateId: null,
    foreign: null,
    attachments: [],
    ...fields,
  };
}

function payment(fields: Partial<PropertyPayment>): PropertyPayment {
  return {
    id: "p1",
    date: "2026-10-22",
    amount: 0,
    method: "bank_transfer",
    dueDate: null,
    checkNumber: null,
    paymentStatus: "cleared",
    tornAt: null,
    accountId: null,
    notes: null,
    referenceNumber: null,
    requiresSplit: false,
    createdAt: null,
    leaseId: null,
    rentPeriodStart: null,
    rentPeriods: 1,
    rentAllocation: null,
    countsAsRent: false,
    foreign: null,
    attachments: [],
    ...fields,
  };
}

// The down payment in US$ (₪330,000 = $100,000 at 3.3), the notary in C$
// (₪24,000 = C$10,000 at 2.4), both on 10/11/2025; a C$5,500 income on 22/10.
const EXPENSES = [
  expense({ id: "down", amount: 330000, foreign: { currency: "USD", amount: 100000, rate: 3.3, rateManual: false } }),
  expense({ id: "notary", amount: 24000, foreign: { currency: "CAD", amount: 10000, rate: 2.4, rateManual: false } }),
];
const PAYMENTS = [payment({ amount: 12100, foreign: { currency: "CAD", amount: 5500, rate: 2.2, rateManual: false } })];

function cells(label: string) {
  const row = screen.getByText(label).closest("tr") as HTMLElement;
  return within(row)
    .getAllByRole("cell")
    .slice(1)
    // Without the left-to-right mark a negative number carries.
    .map((cell) => cell.textContent?.replace(/‎/g, ""));
}

describe("PropertyMoneyCard", () => {
  it("a property in C$: ₪, $ and C$ side by side, each movement at its own day's rate", () => {
    render(<PropertyMoneyCard payments={PAYMENTS} expenses={EXPENSES} sessions={[]} currency="CAD" rates={RATES} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["", "₪", "$", "C$"]);
    // Paid out: the $100,000 stays $100,000 and the C$10,000 stays C$10,000;
    // each is the other currency at 10/11/2025's rate.
    expect(cells("הוצאות ששולמו")).toEqual([
      "354,000",
      (100000 + 24000 / 3.3).toLocaleString("he-IL", { maximumFractionDigits: 0 }),
      (330000 / 2.4 + 10000).toLocaleString("he-IL", { maximumFractionDigits: 0 }),
    ]);
    expect(cells("הכנסות שנכנסו")).toEqual(["12,100", Math.round(12100 / 3.1).toLocaleString("he-IL"), "5,500"]);
    expect(cells("נטו")[0]).toBe("-341,900");
    expect(screen.getByText("כל תנועה בשער היציג של יומה.")).toBeInTheDocument();
  });

  it("…before the rates are in: the ₪ column, and — for the others", () => {
    render(<PropertyMoneyCard payments={[]} expenses={[expense({ amount: 3100 })]} sessions={[]} currency="CAD" rates={null} />);
    expect(cells("הוצאות ששולמו")).toEqual(["3,100", "—", "—"]);
  });

  it("a property in shekels: as before, ₪ only", () => {
    render(<PropertyMoneyCard payments={PAYMENTS} expenses={EXPENSES} sessions={[]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("הוצאות ששולמו").parentElement).toHaveTextContent("354,000");
  });
});
