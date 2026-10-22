// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// A storage property's renters (owner, 2026-10-22: "how can I delete a payment
// here or edit it or view it"): each renter's "תשלומים" — and its month's chip —
// show its payments in the page's table, where each one is seen, edited and
// deleted. Its ⋮ is outlined, as every ⋮ on a detail page.

import { PropertyRentersSection } from "@/app/(app)/properties/[id]/PropertyRenters";
import type { LeaseAgreement } from "@/lib/properties";

afterEach(cleanup);

const lease = {
  id: "lease-davidovitch",
  customerId: "c1",
  customerName: "דוידוביטש",
  unitLabel: "20 קופסאות",
  monthlyRentAmount: 120,
  periodMonths: 1,
  startDate: "2026-10-15",
  endDate: "2027-10-15",
  status: "active",
} as LeaseAgreement;

function renderSection(onShowPayments = vi.fn()) {
  render(
    <PropertyRentersSection
      renters={[
        {
          lease,
          status: { state: "paid", collected: 120, pending: 0, rent: 120, periodStart: "2026-10-15", periodLabel: "אוקטובר" },
        },
      ]}
      ended={[]}
      onRecord={vi.fn()}
      onSchedule={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onNew={vi.fn()}
      onShowPayments={onShowPayments}
    />
  );
  return onShowPayments;
}

describe("a storage property's renters", () => {
  it("'תשלומים' shows that renter's payments", () => {
    const onShowPayments = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "תשלומים" }));
    expect(onShowPayments).toHaveBeenCalledWith(lease);
  });

  it("its month's chip does the same", () => {
    const onShowPayments = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /אוקטובר: שולם/ }));
    expect(onShowPayments).toHaveBeenCalledWith(lease);
  });

  it("its ⋮ is outlined", () => {
    renderSection();
    expect(screen.getByRole("button", { name: "פעולות לדוידוביטש" }).className).toMatch(/border/);
  });
});
