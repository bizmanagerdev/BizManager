// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The checks page by property (owner, 2026-10-21: "we already have a separate
// page to manage checks … make the checks page like a filter by properties"):
// every property's rent checks, or one property's — the rent page links here
// with ?property=rent or ?property=<id>.

const params = vi.hoisted(() => ({ value: "property=rent" }));
vi.mock("next/navigation", async () => ({
  ...(await import("@/__tests__/mocks/next-navigation")),
  useSearchParams: () => new URLSearchParams(params.value),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));

import ChecksClient from "@/app/(app)/checks/ChecksClient";
import type { CheckRow } from "@/lib/checks";

function check(id: string, extra: Partial<CheckRow>): CheckRow {
  return {
    payment_id: id,
    check_number: id,
    amount: 1000,
    due_date: "2026-11-11",
    payment_date: "2026-11-11",
    cleared_at: null,
    status: "pending",
    customer_id: null,
    customer_name: "לקוח",
    customer_phone: null,
    source_type: null,
    source_id: null,
    source_label: null,
    notes: null,
    photo_url: null,
    photo_count: 0,
    account_id: null,
    reference_number: null,
    requires_split: false,
    ...extra,
  };
}

const CHECKS = [
  check("111", { customer_name: "לקוח פרויקט", source_type: "project", source_id: "pr1", source_label: "בית כנסת" }),
  check("262", { customer_name: "רוזנפלד", source_type: "property", source_id: "p-d4", source_label: "D4 הר יונה" }),
  check("300", { customer_name: "זינגער", source_type: "property", source_id: "p-e6", source_label: "E6 הר יונה" }),
];

const shown = () => [...document.querySelectorAll("tbody tr")].map((tr) => tr.textContent ?? "");

describe("the checks page by property", () => {
  it("?property=rent: every property's rent checks, each with its tenant and property", () => {
    params.value = "property=rent";
    render(<ChecksClient checks={CHECKS} />);
    const rows = shown();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("רוזנפלד");
    expect(rows[0]).toContain("D4 הר יונה");
    expect(screen.getAllByRole("link", { name: "D4 הר יונה" })[0]).toHaveAttribute("href", "/properties/p-d4");
  });

  it("one property's, or everyone's again", () => {
    params.value = "property=p-e6";
    render(<ChecksClient checks={CHECKS} />);
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toContain("זינגער");
    fireEvent.change(screen.getByLabelText("נכס"), { target: { value: "" } });
    expect(shown()).toHaveLength(3);
  });
});
