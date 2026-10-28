// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// /financial's loading screen shows first on the way to every page under it
// (the router puts it around them): on the accounts page it has to be that
// page's shape — the cash-flow page's flashed there first (2026-10-28).

const h = vi.hoisted(() => ({ pathname: "/financial" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

import FinancialLoadingBody from "@/app/(app)/financial/FinancialLoadingBody";

function shown(pathname: string) {
  h.pathname = pathname;
  const { unmount } = render(<FinancialLoadingBody cashFlow={<div>cash flow</div>} bank={<div>accounts</div>} />);
  const text = screen.queryByText("accounts") ? "accounts" : screen.queryByText("cash flow") ? "cash flow" : "nothing";
  unmount();
  return text;
}

describe("/financial's loading screen", () => {
  it("the accounts page's shape on the accounts page", () => {
    expect(shown("/financial/bank")).toBe("accounts");
  });

  it("the cash-flow page's shape on the cash-flow page and the pages that have none of their own", () => {
    expect(shown("/financial")).toBe("cash flow");
    expect(shown("/financial/loans")).toBe("cash flow");
    expect(shown("/financial/bankruptcy")).toBe("cash flow");
  });
});
