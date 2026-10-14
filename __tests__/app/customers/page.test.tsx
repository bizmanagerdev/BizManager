// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

// The customers page on the server: the list's read goes out together with
// the "who's asking" check (it waited for it, then three more reads waited in
// turn), it says when it read (so a prefetched copy shown later refreshes
// itself), and a failed read keeps the page's frame — the phone strip open —
// with a Hebrew message and a way to try again.

const deps = vi.hoisted(() => ({
  requireStaffPage: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  loadCustomersPage: vi.fn(),
  clientProps: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/auth/roleAccess", () => ({ requireStaffPage: deps.requireStaffPage }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: deps.createSupabaseServerClient }));
vi.mock("@/app/(app)/customers/loadCustomers", () => ({ loadCustomersPage: deps.loadCustomersPage }));
vi.mock("@/components/layout/AppShell", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function CustomersClientStub(props: Record<string, unknown>) {
      deps.clientProps = props;
      return <div data-testid="customers-client" />;
    },
}));
vi.mock("@/app/(app)/customers/CustomersLoadError", () => ({
  default: ({ message }: { message: string }) => <div data-testid="load-error">{message}</div>,
}));

import CustomersPage from "@/app/(app)/customers/page";
import { NO_CUSTOMERS_FILTERS } from "@/app/(app)/customers/customersFilters";

const supabase = { tag: "server-client" };
const PROFILE = { profile: { full_name: "דנה", email: "d@example.com", role: "office" } };

beforeEach(() => {
  vi.clearAllMocks();
  deps.clientProps = null;
  deps.createSupabaseServerClient.mockResolvedValue(supabase);
});

describe("CustomersPage", () => {
  it("starts the list's read before the sign-in check has answered", async () => {
    let signIn: (value: typeof PROFILE) => void = () => {};
    deps.requireStaffPage.mockReturnValue(new Promise((resolve) => (signIn = resolve)));
    deps.loadCustomersPage.mockResolvedValue({ rows: [{ customer_id: "c1" }], totalCount: 1, hasMore: false, error: null });

    const rendering = CustomersPage({ searchParams: Promise.resolve({ with_debt: "yes" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.loadCustomersPage).toHaveBeenCalledWith(supabase, {
      page: 1,
      filters: { ...NO_CUSTOMERS_FILTERS, withDebt: "yes" },
    });

    signIn(PROFILE);
    render((await rendering) as ReactElement);
    expect(screen.getByTestId("customers-client")).toBeInTheDocument();
    expect(deps.clientProps).toMatchObject({
      initialRows: [{ customer_id: "c1" }],
      initialHasMore: false,
      totalCount: 1,
      initialFilters: { ...NO_CUSTOMERS_FILTERS, withDebt: "yes" },
    });
    expect(typeof deps.clientProps?.loadedAt).toBe("number");
  });

  it("a failed read shows the error view, not the list", async () => {
    deps.requireStaffPage.mockResolvedValue(PROFILE);
    deps.loadCustomersPage.mockResolvedValue({ rows: [], totalCount: 0, hasMore: false, error: "אירעה שגיאה. נסו שוב." });
    render((await CustomersPage({})) as ReactElement);
    expect(screen.getByTestId("load-error")).toHaveTextContent("אירעה שגיאה. נסו שוב.");
    expect(screen.queryByTestId("customers-client")).toBeNull();
  });
});
