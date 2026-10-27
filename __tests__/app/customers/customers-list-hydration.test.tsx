// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

// The customers list as the browser takes over the server's HTML (the server
// version, /customers?data=server): the first browser render must produce
// exactly what the server rendered. Each row's ⋮ (Radix) got a different id in
// the browser than in the server's HTML ("radix-_R_2…" vs "radix-_R_g…",
// 2026-10-20) — the tree above the rows differed between the two.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/customers",
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/app/(app)/customers/actions", () => ({
  loadMoreCustomers: vi.fn(async () => ({ rows: [], hasMore: false, error: null })),
  loadCustomerRowsByIds: vi.fn(async () => ({ rows: [], error: null })),
  findCustomerIdsPassingFilters: vi.fn(async () => ({ ids: [], error: null })),
}));
vi.mock("@/lib/customers/fetchCustomerCore", () => ({ fetchCustomerCore: vi.fn() }));
vi.mock("@/components/customers/EditCustomerDialog", () => ({ EditCustomerDialog: () => null }));
vi.mock("@/hooks/useCustomerSearchIndex", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useCustomerSearchIndex")>("@/hooks/useCustomerSearchIndex");
  return {
    searchCustomerEntries: actual.searchCustomerEntries,
    useCustomerSearchIndex: () => ({ entries: [], loading: false, error: null, stale: false, savedAt: null, load: vi.fn() }),
  };
});

import CustomersClient from "@/app/(app)/customers/CustomersClient";
import { PageTitleProvider } from "@/components/layout/page-title-context";
import { NO_CUSTOMERS_FILTERS } from "@/app/(app)/customers/customersFilters";

const ROWS = [
  {
    customer_id: "c1",
    customer_name: "אבי כהן",
    phone: "050-1234567",
    email: "avi@example.com",
    address: "ירושלים | הרצל 1",
    orders_count: 3,
    projects_count: 1,
    open_balance: 1356.97,
    active: true,
    morning_client_id: "m1",
    linked_user_id: null,
    requires_prepayment: false,
  },
  {
    customer_id: "c2",
    customer_name: "בני לוי",
    phone: null,
    email: null,
    address: null,
    orders_count: 0,
    projects_count: 0,
    open_balance: 0,
    active: false,
    morning_client_id: null,
    linked_user_id: "u9",
    requires_prepayment: true,
  },
];

let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const page = () => (
  <PageTitleProvider>
    <CustomersClient initialRows={ROWS} initialHasMore={false} totalCount={ROWS.length} initialFilters={NO_CUSTOMERS_FILTERS} />
  </PageTitleProvider>
);

/** The server's HTML, hydrated by `client`; everything React reported on the way. */
async function hydrate(serverHtml: string, client: ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.appendChild(container);
  const reported: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => reported.push(args.map(String).join(" ")));
  root = hydrateRoot(container, client, { onRecoverableError: (error) => reported.push(String(error)) });
  await new Promise((resolve) => setTimeout(resolve, 200));
  return { container, reported };
}

describe("the customers list in the browser", () => {
  it("hydrates with the server's ids — every row's ⋮ keeps its id", async () => {
    // The page's search strip, which the list portals its search into.
    const toolbar = document.createElement("div");
    toolbar.id = "page-header-toolbar";
    const html = renderToString(page());
    const serverIds = Array.from(html.matchAll(/id="(radix-[^"]+)"/g), (match) => match[1]);
    expect(serverIds.length).toBeGreaterThanOrEqual(2);

    document.body.appendChild(toolbar);
    const { container, reported } = await hydrate(html, page());
    expect(reported).toEqual([]);
    const clientIds = Array.from(container.querySelectorAll('[id^="radix-"]'), (node) => node.id);
    expect(clientIds).toEqual(serverIds);
  });
});
