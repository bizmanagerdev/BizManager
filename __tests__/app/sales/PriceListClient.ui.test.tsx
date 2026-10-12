// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

// The price list after the owner's decisions of 2026-10-11: a row's edit and
// delete no longer sit on it as an always-visible pencil and bin — a ⋮ at the
// row's end holds them on the computer, a swipe uncovers them on the phone —
// and the delete still asks first, in the app's one confirm dialog. The
// product's code is "מק״ט", the stock tab's word. Mocked at the edges: the
// list's pager, the server actions, and Supabase behind the delete.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

vi.mock("@/hooks/useInfiniteScroll", () => ({
  useInfiniteScroll: ({ initialRows }: { initialRows: unknown[] }) => {
    const [rows, setRows] = useState(initialRows);
    return { rows, setRows, hasMore: false, loading: false, sentinelRef: () => {}, mobileSentinelRef: () => {}, scrollRef: () => {} };
  },
}));
vi.mock("@/app/(app)/sales/actions", () => ({ loadMorePriceList: vi.fn() }));
vi.mock("@/lib/products/productCategories", () => ({ getOrCreateProductCategory: vi.fn() }));

const db = vi.hoisted(() => ({
  deletes: [] as { table: string; column: string; id: string }[],
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    from: (table: string) => ({
      delete: () => ({
        eq: async (column: string, id: string) => {
          db.deletes.push({ table, column, id });
          return { error: null };
        },
      }),
    }),
  }),
}));

// The ⋮ menu inline, opened by a click (Radix's portal and pointer events
// aren't what's under test) — the same stand-in as the projects lists' tests.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: React.ReactNode };
  const Menu = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => {},
  });
  return {
    DropdownMenu: ({ children }: Children) => {
      const [open, setOpen] = React.useState(false);
      return <Menu.Provider value={{ open, setOpen }}>{children}</Menu.Provider>;
    },
    DropdownMenuTrigger: ({ children }: Children) => {
      const { open, setOpen } = React.useContext(Menu);
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => setOpen(!open),
      });
    },
    DropdownMenuContent: ({ children }: Children) =>
      React.useContext(Menu).open ? <div role="menu">{children}</div> : null,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children, onSelect }: Children & { onSelect?: () => void }) => {
      const { setOpen } = React.useContext(Menu);
      return (
        <div
          role="menuitem"
          onClick={() => {
            onSelect?.();
            setOpen(false);
          }}
        >
          {children}
        </div>
      );
    },
  };
});

import PriceListClient from "@/app/(app)/sales/PriceListClient";

const CATEGORIES = [{ id: "cat-1", name: "חומרי בניין", active: true }];
const PRODUCTS = [
  {
    id: "prod-1",
    name: "שקית חול",
    categoryId: "cat-1",
    category: "חומרי בניין",
    lowStockThreshold: 5,
    code: "SND-1",
    unitPrice: 120,
    baseCost: 80,
    stock: 12,
    purchasedAmount: 40,
    soldAmount: 28,
    active: true,
  },
  {
    id: "prod-2",
    name: "מלט",
    categoryId: "cat-1",
    category: "חומרי בניין",
    lowStockThreshold: 5,
    code: null,
    unitPrice: null,
    baseCost: null,
    stock: null,
    purchasedAmount: 0,
    soldAmount: 0,
    active: true,
  },
];

function renderList() {
  return render(<PriceListClient initialProducts={PRODUCTS} initialCategories={CATEGORIES} totalCount={PRODUCTS.length} />);
}

/** The computer's table (the PDF template's own table is hidden from the page). */
const table = () => screen.getByRole("table");
const rowOf = (name: string) => within(table()).getByText(name).closest("tr")!;

/** Opens a row's ⋮ and returns its menu. */
function openRowMenu(name: string) {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: "פעולות" }));
  return screen.getByRole("menu");
}

describe("PriceListClient — the computer's table", () => {
  beforeEach(() => {
    db.deletes = [];
  });

  it("keeps the row quiet: no pencil or bin on it, a ⋮ at its end, the code headed מק״ט", () => {
    renderList();
    expect(within(table()).queryByRole("button", { name: "עריכה" })).toBeNull();
    expect(within(table()).queryByRole("button", { name: "מחיקה" })).toBeNull();
    expect(within(table()).getAllByRole("button", { name: "פעולות" })).toHaveLength(2);
    expect(within(table()).getByRole("columnheader", { name: "מק״ט" })).toBeInTheDocument();
    expect(within(table()).queryByRole("columnheader", { name: "קוד" })).toBeNull();
    // A missing value is "—", not "-".
    expect(within(rowOf("מלט")).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(rowOf("מלט")).queryByText("-")).toBeNull();
  });

  it("the ⋮'s מחיקה asks first, then deletes that product and drops its row", async () => {
    renderList();
    const menu = openRowMenu("שקית חול");
    expect(within(menu).getByRole("menuitem", { name: "עריכה" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "מחיקה" }));

    const ask = await screen.findByRole("dialog");
    expect(within(ask).getByText(/למחוק את המוצר "שקית חול"/)).toBeInTheDocument();
    expect(db.deletes).toEqual([]);
    fireEvent.click(within(ask).getByRole("button", { name: "מחיקה" }));

    await waitFor(() => expect(db.deletes).toEqual([{ table: "products", column: "id", id: "prod-1" }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(table()).queryByText("שקית חול")).toBeNull();
    expect(within(table()).getByText("מלט")).toBeInTheDocument();
  });

  it("a cancelled delete deletes nothing", async () => {
    renderList();
    fireEvent.click(within(openRowMenu("שקית חול")).getByRole("menuitem", { name: "מחיקה" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(db.deletes).toEqual([]);
    expect(within(table()).getByText("שקית חול")).toBeInTheDocument();
  });

  it("the ⋮'s עריכה opens that product's form, its code under מק״ט, marked required", async () => {
    renderList();
    fireEvent.click(within(openRowMenu("שקית חול")).getByRole("menuitem", { name: "עריכה" }));

    const form = await screen.findByRole("dialog");
    expect(within(form).getByRole("heading", { name: "עריכת מוצר" })).toBeInTheDocument();
    expect(within(form).getByDisplayValue("שקית חול")).toBeInTheDocument();
    expect(within(form).getByDisplayValue("SND-1")).toBeInTheDocument();
    const codeLabel = within(form).getByText("מק״ט", { selector: "label" });
    expect(codeLabel).toHaveTextContent("מק״ט *");
    expect(within(form).queryByText(/קוד מוצר/)).toBeNull();
  });
});

describe("PriceListClient — the phone's cards", () => {
  beforeEach(() => {
    db.deletes = [];
  });

  /** A product's phone card: the one under a swipe. */
  const cardOf = (name: string) =>
    screen.getAllByText(name).find((el) => el.closest("[data-swipe-owner]"))!.closest("[data-swipe-owner]")! as HTMLElement;

  it("carries no buttons of its own; a swipe uncovers edit and delete, and the delete asks first", async () => {
    renderList();
    const card = cardOf("שקית חול");
    // Closed, the tiles under the card are out of reach.
    expect(within(card).queryByRole("button", { name: "עריכה" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "מחיקה" })).toBeNull();

    const surface = within(card).getByText("שקית חול").closest(".touch-pan-y")!;
    fireEvent.pointerDown(surface, { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surface, { pointerType: "touch", clientX: 200, clientY: 12 });
    fireEvent.pointerUp(surface, { pointerType: "touch", clientX: 200, clientY: 12 });

    expect(within(card).getByRole("button", { name: "עריכה" })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "מחיקה" }));
    const ask = await screen.findByRole("dialog");
    expect(within(ask).getByText(/למחוק את המוצר "שקית חול"/)).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: "מחיקה" }));
    await waitFor(() => expect(db.deletes).toEqual([{ table: "products", column: "id", id: "prod-1" }]));
  });
});
