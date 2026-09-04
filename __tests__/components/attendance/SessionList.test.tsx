// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SessionList, { type SessionListItem } from "@/components/attendance/SessionList";
import { formatCurrency, type WorkSessionRow } from "@/lib/payroll";

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

function makeSession(overrides: Partial<WorkSessionRow>): WorkSessionRow {
  return {
    id: "s1",
    user_id: "u1",
    clock_in: "2026-08-10T12:00:00.000Z",
    clock_out: "2026-08-10T16:00:00.000Z",
    worked_minutes: 240,
    labor_cost: null,
    is_billable_to_customer: null,
    bill_to_customer_amount: null,
    billing_status: null,
    notes: null,
    business_domain: "general_business",
    project_id: null,
    property_id: null,
    ...overrides,
  };
}

describe("SessionList — per-shift amount", () => {
  it("shows the shift's ₪ amount alongside its payment status when labor_cost is set", () => {
    const items: SessionListItem[] = [
      { session: makeSession({ id: "s1", labor_cost: 240 }), paymentStatus: "unpaid" },
    ];
    render(<SessionList items={items} locale="he" />);

    // Renders once in the mobile card and once in the desktop table — both live
    // in the DOM at once (CSS media queries don't apply in jsdom).
    expect(screen.getAllByText(formatCurrency(240)).length).toBe(2);
    expect(screen.getAllByText("לא שולם").length).toBe(2);
  });

  it("shows nothing where there's no labor_cost to report", () => {
    const items: SessionListItem[] = [{ session: makeSession({ id: "s2", labor_cost: null }) }];
    render(<SessionList items={items} locale="he" />);

    expect(screen.queryByText(formatCurrency(0))).not.toBeInTheDocument();
  });
});
