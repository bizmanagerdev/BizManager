// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// A tenant's rent on their customer page (owner, 2026-10-25: "for sure should
// be in the customer's open debt"): in חוב פתוח and the banner, a "שכירות"
// line with what's in of what was due and what's still owed — and the check we
// hold for it ("I want to show that it's debt, and I want to show that we have
// it"). סה״כ מכירות stays orders and projects.

import CustomerMoneyCard from "@/app/(app)/customers/[id]/CustomerMoneyCard";
import { customerRentOf, summarizeCustomerMoney } from "@/app/(app)/customers/[id]/customerPageModel";
import { buildCounterpartyBalance } from "@/lib/customers/counterpartyBalance";
import type { CustomerReceivable } from "@/lib/collections";
import { settled, NO_PAYMENTS } from "@/__tests__/app/customers/customerPageFixtures";

afterEach(cleanup);

const RENT = { due: 12000, paid: 4000, owed: 8000, withCheck: 4000, oldest: "2026-09-01" };

/** Collections' rent row: its own days-late — the page's comes from the rent rule. */
const RENT_ROW = { source_type: "property", days_late: 400, due_date: "2025-01-01", payment_terms: null } as unknown as CustomerReceivable;

describe("a tenant's money", () => {
  it("their leases' debts summed, the oldest month owing kept", () => {
    expect(
      customerRentOf([
        { due: 8000, paid: 4000, amount: 4000, withCheck: 0, oldest: "2026-09-01" },
        { due: 4000, paid: 0, amount: 4000, withCheck: 4000, oldest: "2026-10-01" },
      ])
    ).toEqual(RENT);
    expect(customerRentOf([])).toBeNull();
  });

  it("rent is in חוב פתוח, apart from sales; its lateness is the rent rule's", () => {
    const money = summarizeCustomerMoney({ orders: [], projects: [], receivables: [RENT_ROW], rent: RENT, today: "2026-10-21" });
    expect(money).toMatchObject({ openBalance: 8000, salesOpenBalance: 0, totalSales: 0, maxDaysLate: 50, rent: RENT });
    expect(money.dueDate).toBeNull();
  });

  it("the card: חוב פתוח with rent, a שכירות line with the check we hold — no sales line for a tenant with none", () => {
    const money = summarizeCustomerMoney({ orders: [], projects: [], receivables: [], rent: RENT, today: "2026-10-21" });
    render(
      <CustomerMoneyCard
        money={money}
        balance={buildCounterpartyBalance({ salesOwedToUs: 0, rentOwedToUs: 8000, loansOwedToUs: 0, loansOwedByUs: 1000, payrollOwed: null })}
        payments={settled(NO_PAYMENTS)}
        today="2026-10-21"
        onCollectionActions={null}
      />
    );
    expect(screen.getByText("₪8,000", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText("שולם חלקית")).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/שכירות.*4,000.*מתוך.*12,000.*חוב.*8,000.*צ׳ק ביד.*4,000/);
    expect(screen.queryByText("נגבה")).toBeNull();
    expect(screen.queryByText("תנאי תשלום")).toBeNull();
    // מאזן מול העסק: rent its own row.
    expect(screen.getAllByText("שכירות").length).toBe(2);
  });

  it("no lease: as before — no rent line", () => {
    const money = summarizeCustomerMoney({ orders: [], projects: [], receivables: [] });
    expect(money.rent).toBeNull();
    render(
      <CustomerMoneyCard money={money} balance={null} payments={settled(NO_PAYMENTS)} today="2026-10-21" onCollectionActions={null} />
    );
    expect(screen.getByText("נגבה")).toBeInTheDocument();
    expect(screen.queryByText("שכירות")).toBeNull();
  });
});
