// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The device version of /sales: the tab counts and the open tab's list from
// the device, the next pages from the device as the list scrolls, and the
// server version when the copy can't serve it.

const nav = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace }, search: "tab=closed" };
});
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// A fresh device database per test (beforeEach), like a fresh sign-in: nothing kept from the last test.
const newDb = () => ({ get: async () => ({ n: 3 }), getAll: async () => [], onChange: () => () => {} });
const device = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/powersync/store", () => ({
  useLocalDatabase: () => device.db,
  useLocalSyncStatus: () => ({ hasSynced: true }),
}));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

const computeLocalCard = vi.hoisted(() => vi.fn());
const computeLocalListPage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/powersync/dashboard-local", () => ({
  computeLocalCard,
  computeLocalListPage,
  LOCAL_CARD_TABLES: { salesOrders: ["orders"], salesCounts: ["orders"] },
}));
vi.mock("@/lib/powersync/local-supabase", () => ({ createLocalSupabase: () => ({}), LOCAL_TABLES: new Set(["orders"]) }));

// The tab bar and the list are the server version's components; here they
// show what they were given, and the list asks for page 2 the way its
// fetch-as-you-scroll does.
vi.mock("@/app/(app)/sales/SalesHeader", () => ({
  default: (props: { counts: { closed: number } }) => <div>closed: {props.counts.closed}</div>,
  SalesHeaderSkeleton: () => null,
}));
vi.mock("@/app/(app)/sales/SalesDeliveriesQueue", () => ({ default: () => null }));
vi.mock("@/app/(app)/sales/PriceListClient", () => ({
  default: (props: { initialProducts: Array<{ name: string }> }) => <div>price list: {props.initialProducts.map((p) => p.name).join(",")}</div>,
}));
vi.mock("@/app/(app)/sales/SalesInventoryClient", () => ({
  default: (props: { initialItems: Array<{ productId: string }> }) => <div>stock: {props.initialItems.map((i) => i.productId).join(",")}</div>,
}));
vi.mock("@/app/(app)/sales/SalesOrdersClient", async () => {
  const { useLocalListPager } = await import("@/components/powersync/LocalListPager");
  const { useState } = await import("react");
  return {
    default: function Orders(props: { orders: Array<{ order_id: string }>; view: string; totalCount: number }) {
      const pager = useLocalListPager<{ order_id: string }>();
      const [more, setMore] = useState<string[]>([]);
      return (
        <div>
          <span>view: {props.view}</span>
          <span>total: {props.totalCount}</span>
          <ul aria-label="orders">
            {[...props.orders.map((o) => o.order_id), ...more].map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
          <button onClick={() => void pager?.(2).then((page) => setMore(page.rows.map((r) => r.order_id)))}>more</button>
        </div>
      );
    },
  };
});

import LocalSalesPage from "@/app/(app)/sales/LocalSalesPage";

const props = {
  viewer: { userId: "me", role: "admin", locale: "he" as const },
  activeTab: "closed" as const,
  customerId: null,
  customerName: null,
  category: "",
  paymentStatus: "" as const,
  invoice: "" as const,
  regionFilter: null,
  regionLinks: [],
  tabsSearchParams: { tab: "closed" },
  canRemind: true,
};
const counts = { orders: 5, closed: 239, inventory: 12, "price-list": 12, deliveries: 3 };
const shown = () => screen.queryAllByRole("listitem").map((li) => li.textContent);

describe("LocalSalesPage", () => {
  beforeEach(() => {
    localStorage.clear(); // a fresh device: nothing stored from the last test
    device.db = newDb();
    nav.replace.mockReset();
    computeLocalCard.mockReset();
    computeLocalListPage.mockReset();
  });

  it("the closed tab and its counts from the device; page 2 from the device as it scrolls", async () => {
    computeLocalCard.mockImplementation(async (_local, kind, _viewer, filters) =>
      kind === "salesCounts" ? { filters, counts } : { filters, rows: [{ order_id: "o1" }], hasMore: true }
    );
    computeLocalListPage.mockResolvedValue({ rows: [{ order_id: "o2" }], hasMore: false });
    render(<LocalSalesPage {...props} />);
    expect(await screen.findByText("closed: 239")).toBeTruthy();
    // The list component is loaded on demand, a moment after the tab bar.
    expect(await screen.findByText("view: closed")).toBeTruthy();
    expect(screen.getByText("total: 239")).toBeTruthy();
    expect(shown()).toEqual(["o1"]);
    expect(computeLocalCard).toHaveBeenCalledWith(expect.anything(), "salesOrders", props.viewer, {
      tab: "closed", customerId: null, q: "", paymentStatus: "", invoice: "",
    });

    await act(async () => fireEvent.click(screen.getByText("more")));
    expect(shown()).toEqual(["o1", "o2"]);
    expect(computeLocalListPage).toHaveBeenCalledWith(expect.anything(), "salesOrders", expect.objectContaining({ tab: "closed" }), 2);
  });

  it("goes to the server version when the device can't work it out", async () => {
    computeLocalCard.mockRejectedValue(new Error("boom"));
    render(<LocalSalesPage {...props} />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sales?tab=closed&data=server"));
  });

  it("price list → stock (same filters, other list): never shows one tab's data as the other's", async () => {
    let finishStock: (value: unknown) => void = () => {};
    computeLocalCard.mockImplementation((_local, kind, _viewer, filters) => {
      if (kind === "salesCounts") return Promise.resolve({ filters, counts });
      if (kind === "salesPriceList") return Promise.resolve({ filters, products: [{ name: "כיסא" }], categories: [], hasMore: false });
      return new Promise((resolve) => (finishStock = resolve));
    });
    const priceList = { ...props, activeTab: "price-list" as const, tabsSearchParams: { tab: "price-list" } };
    const { rerender } = render(<LocalSalesPage {...priceList} />);
    expect(await screen.findByText("price list: כיסא")).toBeTruthy();

    rerender(<LocalSalesPage {...priceList} activeTab="inventory" tabsSearchParams={{ tab: "inventory" }} />);
    expect(screen.queryByText(/price list/)).toBeNull();
    expect(screen.queryByText(/stock/)).toBeNull();

    await waitFor(() => expect(computeLocalCard).toHaveBeenCalledWith(expect.anything(), "salesInventory", expect.anything(), expect.anything()));
    await act(async () => finishStock({ filters: { q: "", category: "" }, items: [{ productId: "p1" }], movements: [], orderCustomerById: {}, performerNameById: {}, hasMore: false }));
    expect(await screen.findByText("stock: p1")).toBeTruthy();
  });

  // Every tab has its search / filters in the phone's header strip (owner,
  // 2026-10-08: switching between a tab with one and a tab without moved the
  // tabs and the list ~55 px), and the strip is held open while a tab loads.
  it("every tab holds the phone's header strip open, before it arrives too", () => {
    computeLocalCard.mockImplementation(() => new Promise(() => {}));
    for (const tab of ["orders", "closed", "inventory", "price-list", "deliveries"] as const) {
      const { container, unmount } = render(<LocalSalesPage {...props} activeTab={tab} tabsSearchParams={{ tab }} />);
      expect(container.querySelector("[data-page-header-toolbar]"), tab).not.toBeNull();
      unmount();
    }
  });
});
