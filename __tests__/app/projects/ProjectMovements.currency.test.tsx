// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectMovements, { type Movement } from "@/app/(app)/projects/[id]/ProjectMovements";

// A row in US$ or C$ in the project's and property's money table: its dollars,
// its shekels under them, and the totals in shekels (2026-10-23).

function movement(fields: Partial<Movement>): Movement {
  return {
    key: "payment:p1",
    direction: "in",
    date: "2026-09-08",
    category: null,
    name: "Zelle",
    status: "cleared",
    billed: false,
    billedAmount: null,
    amount: 3107,
    account: "Chase",
    hint: null,
    extras: [],
    attachments: [],
    ...fields,
  };
}

describe("ProjectMovements — a row in US$", () => {
  it("shows $1,000 with ≈ ₪3,107 under it; a shekel row stays as it was", () => {
    render(
      <ProjectMovements
        movements={[
          movement({ foreign: { currency: "USD", amount: 1000, rate: 3.107, rateManual: false } }),
          movement({ key: "expense:e1", direction: "out", name: "חומרי בניה", amount: 450 }),
        ]}
        groupBy="none"
        sortBy="date"
        sortDirection="desc"
      />
    );
    expect(screen.getAllByText(/\$1,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("≈ ₪3,107").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$450/)).toBeNull();
  });
});
