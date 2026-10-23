// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

// The customers page on the server. A device with its copy gets the device
// version (LocalCustomersPage, on for admins and office from 2026-10-23) and
// the server reads nothing for it. Everyone else gets the server version: the
// list's read goes out after the "who's asking" check — or at once for
// ?data=server, the device version's way back — it says when it read (so a
// prefetched copy shown later refreshes itself), and a failed read keeps the
// page's frame — the phone strip open — with a Hebrew message and a way to try
// again.

const deps = vi.hoisted(() => ({
  requireStaffPage: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  loadCustomersPage: vi.fn(),
  clientProps: null as Record<string, unknown> | null,
  deviceOn: { current: false },
  localProps: null as Record<string, unknown> | null,
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
vi.mock("@/lib/powersync/device-check", () => ({
  devicePageOn: async () => deps.deviceOn.current,
  deviceCheckDue: async () => false,
}));
vi.mock("@/app/(app)/customers/LocalCustomersPage", () => ({
  default: (props: Record<string, unknown>) => {
    deps.localProps = props;
    return <div data-testid="local-customers" />;
  },
}));
vi.mock("@/app/(app)/customers/CustomersServerCheck", () => ({ default: () => null }));
vi.mock("@/components/powersync/DashboardLocalShadow", () => ({ default: () => null }));
vi.mock("@/components/powersync/DeviceFrameMark", () => ({ default: () => null }));
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
  deps.localProps = null;
  deps.deviceOn.current = false;
  deps.createSupabaseServerClient.mockResolvedValue(supabase);
});

describe("CustomersPage", () => {
  it("a device with its copy: the device version, and the server reads nothing for it", async () => {
    deps.deviceOn.current = true;
    deps.requireStaffPage.mockResolvedValue({ profile: { ...PROFILE.profile, id: "u1", locale: "he" } });
    render((await CustomersPage({ searchParams: Promise.resolve({ with_debt: "yes" }) })) as ReactElement);
    expect(screen.getByTestId("local-customers")).toBeInTheDocument();
    expect(deps.localProps).toEqual({ viewer: { userId: "u1", role: "office", locale: "he" } });
    expect(deps.loadCustomersPage).not.toHaveBeenCalled();
  });

  it("no copy on this device: the list's read goes out after the sign-in check", async () => {
    let signIn: (value: typeof PROFILE) => void = () => {};
    deps.requireStaffPage.mockReturnValue(new Promise((resolve) => (signIn = resolve)));
    deps.loadCustomersPage.mockResolvedValue({ rows: [{ customer_id: "c1" }], totalCount: 1, hasMore: false, error: null });

    const rendering = CustomersPage({ searchParams: Promise.resolve({ with_debt: "yes" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.loadCustomersPage).not.toHaveBeenCalled();

    signIn(PROFILE);
    render((await rendering) as ReactElement);
    expect(screen.getByTestId("customers-client")).toBeInTheDocument();
    expect(deps.clientProps).toMatchObject({
      initialRows: [{ customer_id: "c1" }],
      initialHasMore: false,
      totalCount: 1,
      initialFilters: { ...NO_CUSTOMERS_FILTERS, withDebt: "yes" },
    });
    expect(deps.loadCustomersPage).toHaveBeenCalledWith(supabase, {
      page: 1,
      filters: { ...NO_CUSTOMERS_FILTERS, withDebt: "yes" },
    });
    expect(typeof deps.clientProps?.loadedAt).toBe("number");
  });

  it("?data=server — the device version's way back: the list's read goes out before the sign-in check", async () => {
    deps.deviceOn.current = true;
    deps.requireStaffPage.mockReturnValue(new Promise(() => {}));
    deps.loadCustomersPage.mockResolvedValue({ rows: [], totalCount: 0, hasMore: false, error: null });
    void CustomersPage({ searchParams: Promise.resolve({ data: "server" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.loadCustomersPage).toHaveBeenCalledWith(supabase, { page: 1, filters: NO_CUSTOMERS_FILTERS });
  });

  it("a failed read shows the error view, not the list", async () => {
    deps.requireStaffPage.mockResolvedValue(PROFILE);
    deps.loadCustomersPage.mockResolvedValue({ rows: [], totalCount: 0, hasMore: false, error: "אירעה שגיאה. נסו שוב." });
    render((await CustomersPage({})) as ReactElement);
    expect(screen.getByTestId("load-error")).toHaveTextContent("אירעה שגיאה. נסו שוב.");
    expect(screen.queryByTestId("customers-client")).toBeNull();
  });
});
