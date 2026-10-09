// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

// The device version of an order's page: the order from the device copy at
// once, its documents/photos/history from the server as they come; an order
// the copy doesn't hold yet waits a little, then the server version; and the
// moment a row is tapped (or the page is loading) the page itself from the
// copy when there is one — else the order named from its row.

const nav = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));

const newDb = () => ({ get: async () => ({ n: 3 }), getAll: async () => [], onChange: () => () => {} });
const device = vi.hoisted(() => ({
  db: null as unknown,
  status: { hasSynced: true } as { hasSynced: boolean } | null,
  viewer: null as { id: string; role: string; locale: "he"; name: string | null } | null,
}));
vi.mock("@/lib/powersync/store", () => ({
  useLocalDatabase: () => device.db,
  useLocalSyncStatus: () => device.status,
  useLocalViewer: () => device.viewer,
}));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

const computeLocalCard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/powersync/dashboard-local", () => ({
  computeLocalCard,
  LOCAL_CARD_TABLES: { orderPage: ["orders"] },
}));
vi.mock("@/lib/powersync/local-supabase", () => ({ createLocalSupabase: () => ({}), LOCAL_TABLES: new Set(["orders"]) }));

// The page's own view is the server version's; here it shows what it was given.
vi.mock("@/app/(app)/sales/orders/[id]/OrderPageView", () => ({
  default: function View(props: {
    id: string;
    core: { order: { status: string } | null };
    extras: { deliveryImages: unknown[] } | null;
    viewer: { role: string; name: string | null };
  }) {
    return (
      <div>
        <span>order {props.id}: {props.core.order?.status}</span>
        <span>{props.extras ? `photos: ${props.extras.deliveryImages.length}` : "photos on their way"}</span>
        <span>by {props.viewer.name}</span>
      </div>
    );
  },
}));
vi.mock("@/app/(app)/sales/orders/[id]/OrderPagePreview", () => ({
  default: ({ preview }: { preview: { customerName: string } }) => <span>preview of {preview.customerName}</span>,
}));
vi.mock("@/app/(app)/sales/orders/[id]/OrderPageSkeleton", () => ({ default: () => <span>grey blocks</span> }));

import LocalOrderPage from "@/app/(app)/sales/orders/[id]/LocalOrderPage";
import OrderPageOpening from "@/app/(app)/sales/orders/[id]/OrderPageOpening";

const viewer = { userId: "me", role: "admin", locale: "he" as const, name: "דנה" };
const preview = { id: "o1", customerId: "c1", customerName: "פיצה אורי", customerDisplayName: "פיצה אורי" };
const core = (id: string, order: { status: string } | null) => ({
  filters: { id },
  order,
  items: [],
  payments: [],
  financials: null,
  customer: null,
  branch: null,
  products: [],
  names: {},
  commentAuthorColors: {},
  errors: { order: null, items: null, payments: null, financials: null },
});

describe("LocalOrderPage", () => {
  beforeEach(() => {
    localStorage.clear();
    device.db = newDb();
    device.status = { hasSynced: true };
    device.viewer = null;
    nav.replace.mockReset();
    computeLocalCard.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("the order from the device at once; the server's parts fill in when they arrive", async () => {
    computeLocalCard.mockImplementation(async (_local, _kind, _viewer, filters: { id: string }) => core(filters.id, { status: "confirmed" }));
    let deliver: (value: { deliveryImages: unknown[] }) => void = () => {};
    const extras = new Promise<{ deliveryImages: unknown[] }>((resolve) => (deliver = resolve));
    render(<LocalOrderPage id="o1" viewer={viewer} extras={extras as never} />);

    expect(await screen.findByText("order o1: confirmed")).toBeTruthy();
    expect(screen.getByText("photos on their way")).toBeTruthy();
    expect(screen.getByText("by דנה")).toBeTruthy();
    expect(computeLocalCard).toHaveBeenCalledWith(expect.anything(), "orderPage", { userId: "me", role: "admin", locale: "he" }, { id: "o1" });

    await act(async () => deliver({ deliveryImages: [{ id: "d1" }] }));
    expect(screen.getByText("photos: 1")).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("an order the copy doesn't hold yet: waits for it a moment, then the server version", async () => {
    computeLocalCard.mockImplementation(async (_local, _kind, _viewer, filters: { id: string }) => core(filters.id, null));
    render(<LocalOrderPage id="o404" viewer={viewer} extras={null} preview={{ ...preview, id: "o404" }} />);
    await waitFor(() => expect(computeLocalCard).toHaveBeenCalled());
    expect(screen.getByText("preview of פיצה אורי")).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sales/orders/o404?data=server"), { timeout: 4000 });
  });

  it("the device can't work it out: the server version", async () => {
    computeLocalCard.mockRejectedValue(new Error("Column orders.x isn't available on the device"));
    render(<LocalOrderPage id="o1" viewer={viewer} extras={null} />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/sales/orders/o1?data=server"));
  });
});

describe("OrderPageOpening (a tapped row, the loading screen)", () => {
  beforeEach(() => {
    localStorage.clear();
    device.db = newDb();
    device.status = { hasSynced: true };
    nav.replace.mockReset();
    computeLocalCard.mockReset();
    computeLocalCard.mockImplementation(async (_local, _kind, _viewer, filters: { id: string }) => core(filters.id, { status: "delivered" }));
  });
  afterEach(cleanup);

  it("with a complete copy on the device: the page itself, from it", async () => {
    device.viewer = { id: "me", role: "office", locale: "he", name: "דנה" };
    render(<OrderPageOpening id="o1" preview={preview} />);
    expect(await screen.findByText("order o1: delivered")).toBeTruthy();
  });

  it("without one (not a device user, or the copy still downloading): the order named from its row", () => {
    device.viewer = null;
    const { unmount } = render(<OrderPageOpening id="o1" preview={preview} />);
    expect(screen.getByText("preview of פיצה אורי")).toBeTruthy();
    unmount();

    device.viewer = { id: "me", role: "admin", locale: "he", name: null };
    device.status = { hasSynced: false };
    render(<OrderPageOpening id="o1" preview={null} />);
    expect(screen.getByText("grey blocks")).toBeTruthy();
    expect(computeLocalCard).not.toHaveBeenCalled();
  });

  it("a worker never gets it (their copy has no order pages)", () => {
    device.viewer = { id: "w1", role: "worker", locale: "he", name: null };
    render(<OrderPageOpening id="o1" preview={preview} />);
    expect(screen.getByText("preview of פיצה אורי")).toBeTruthy();
  });
});
