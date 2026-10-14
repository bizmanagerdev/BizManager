// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

// The customers list after the owner's decisions of 2026-10-13 and the
// "next pages" playbook:
// - the computer's table: a quiet ⋮ per row (עריכה, + הזמנה, + פרויקט) — the
//   two always-visible buttons are gone; no סטטוס column (an inactive
//   customer gets a quiet grey "לא פעיל" by the name); Morning stays;
// - opening a customer is a client navigation, fetched ahead on hover;
// - the phone cards: the list card's parts, a plain number and the green call
//   button, the debt as "חוב פתוח" in whole shekels;
// - the search shows every match within the filters, a page at a time, with
//   placeholders (not zeros) until the server's figures come;
// - empty states, a failed or offline "load more", edits patched in place.

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/customers",
}));

const net = vi.hoisted(() => ({ online: true }));
vi.mock("@/hooks/useOfflineRows", () => ({ useOnline: () => net.online }));

type IndexEntry = {
  id: string;
  name: string;
  name_for_invoice: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  requires_prepayment: boolean;
  contacts: [];
  branches: [];
};
const index = vi.hoisted(() => ({
  entries: [] as unknown[],
  loading: false,
  error: null as string | null,
  stale: false,
  load: vi.fn(),
}));
vi.mock("@/hooks/useCustomerSearchIndex", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useCustomerSearchIndex")>("@/hooks/useCustomerSearchIndex");
  return {
    searchCustomerEntries: actual.searchCustomerEntries,
    useCustomerSearchIndex: () => ({
      entries: index.entries,
      loading: index.loading,
      error: index.error,
      stale: index.stale,
      savedAt: null,
      load: index.load,
    }),
  };
});

const actions = vi.hoisted(() => ({
  loadMoreCustomers: vi.fn(),
  loadCustomerRowsByIds: vi.fn(),
  findCustomerIdsPassingFilters: vi.fn(),
}));
vi.mock("@/app/(app)/customers/actions", () => actions);

const core = vi.hoisted(() => ({ fetchCustomerCore: vi.fn() }));
vi.mock("@/lib/customers/fetchCustomerCore", () => core);

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// The edit dialog itself has its own tests: here it only has to open with the
// right customer and hand back a save / an undo.
type DialogProps = {
  open: boolean;
  customer: { id: string; name: string; notes: string | null } | null;
  onSaved: (payload: { customer: Record<string, unknown>; contacts: unknown[]; queued?: boolean }) => void;
  onUndone?: (payload: { customer: Record<string, unknown>; contacts: unknown[]; queued?: boolean }) => void;
};
const dialog = vi.hoisted(() => ({ last: null as DialogProps | null }));
vi.mock("@/components/customers/EditCustomerDialog", () => ({
  EditCustomerDialog: (props: DialogProps) => {
    dialog.last = props;
    return props.open ? <div role="dialog">עריכת {props.customer?.name}</div> : null;
  },
}));

// The ⋮ menu inline, opened by a click (Radix's portal and pointer events
// aren't what's under test) — the projects list tests' stand-in.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: ReactNode };
  const Menu = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    DropdownMenu: ({ children }: Children) => {
      const [open, setOpen] = React.useState(false);
      return <Menu.Provider value={{ open, setOpen }}>{children}</Menu.Provider>;
    },
    DropdownMenuTrigger: ({ children }: Children) => {
      const { open, setOpen } = React.useContext(Menu);
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, { onClick: () => setOpen(!open) });
    },
    DropdownMenuContent: ({ children }: Children) => (React.useContext(Menu).open ? <div role="menu">{children}</div> : null),
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

// IntersectionObserver, by hand: a test scrolls to the bottom by telling every
// live observer its sentinel is on screen.
const observers = vi.hoisted(() => ({ live: [] as Array<{ callback: IntersectionObserverCallback; on: boolean }> }));
beforeAll(() => {
  class FakeObserver {
    record: { callback: IntersectionObserverCallback; on: boolean };
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, on: true };
      observers.live.push(this.record);
    }
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
    disconnect() {
      this.record.on = false;
    }
  }
  // @ts-expect-error - test stand-in
  window.IntersectionObserver = FakeObserver;
});
function scrollToBottom() {
  act(() => {
    for (const record of observers.live.filter((r) => r.on)) {
      record.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

import CustomersClient, { mergeFirstPage } from "@/app/(app)/customers/CustomersClient";
import { PageTitleProvider, usePageTitle } from "@/components/layout/page-title-context";
import { NO_CUSTOMERS_FILTERS, type CustomersFilters } from "@/app/(app)/customers/customersFilters";

type Row = Record<string, unknown>;

const AVI: Row = {
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
  notes: "לקוח ותיק",
  registration_number: "514",
  name_for_invoice: "אבי בע״מ",
  whatsapp: "0501234567",
};
const BENNY: Row = {
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
};

function indexEntry(id: string, name: string, extra: Partial<IndexEntry> = {}): IndexEntry {
  return {
    id,
    name,
    name_for_invoice: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    active: true,
    requires_prepayment: false,
    contacts: [],
    branches: [],
    ...extra,
  };
}

function TitleProbe() {
  const title = usePageTitle();
  return <div data-testid="title">{title ? `${String(title.title)} / ${title.subtitle ?? ""}` : ""}</div>;
}

function renderList({
  rows = [AVI, BENNY],
  hasMore = false,
  totalCount,
  filters = NO_CUSTOMERS_FILTERS,
}: { rows?: Row[]; hasMore?: boolean; totalCount?: number; filters?: CustomersFilters } = {}) {
  const ui = (initialRows: Row[], initialHasMore: boolean, count: number, initialFilters: CustomersFilters) => (
    <PageTitleProvider>
      <TitleProbe />
      <CustomersClient
        initialRows={initialRows}
        initialHasMore={initialHasMore}
        totalCount={count}
        initialFilters={initialFilters}
      />
    </PageTitleProvider>
  );
  const result = render(ui(rows, hasMore, totalCount ?? rows.length, filters));
  return {
    ...result,
    rerenderWith: (next: { rows: Row[]; hasMore?: boolean; totalCount?: number; filters?: CustomersFilters }) =>
      result.rerender(ui(next.rows, next.hasMore ?? false, next.totalCount ?? next.rows.length, next.filters ?? filters)),
  };
}

const table = () => screen.getByRole("table");
const tableRow = (name: string) => within(table()).getByText(name).closest("tr") as HTMLElement;
/** The phone card's body (the part that opens the customer), not the table row. */
const card = (name: string) => screen.getAllByText(name).find((el) => !el.closest("tr"))!.closest(".p-3") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  net.online = true;
  index.entries = [];
  index.loading = false;
  index.error = null;
  index.stale = false;
  observers.live = [];
  dialog.last = null;
  actions.loadMoreCustomers.mockResolvedValue({ rows: [], hasMore: false, error: null });
  actions.loadCustomerRowsByIds.mockResolvedValue({ rows: [], error: null });
  actions.findCustomerIdsPassingFilters.mockResolvedValue({ ids: [], error: null });
  if (!document.getElementById("page-header-toolbar")) {
    const host = document.createElement("div");
    host.id = "page-header-toolbar";
    document.body.appendChild(host);
  }
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => net.online });
});

describe("CustomersClient — the computer's table", () => {
  it("has no סטטוס column, keeps Morning, and ends each row in a quiet ⋮", () => {
    renderList();
    const headers = within(table()).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["לקוח", "טלפון ואימייל", "כתובת", "Morning", "הזמנות", "פרויקטים", "חוב פתוח", "פעולות"]);
    expect(headers).not.toContain("סטטוס");
    // The two always-visible buttons are gone; the ⋮ is there instead.
    expect(within(tableRow("אבי כהן")).queryByText("+ הזמנה")).toBeNull();
    expect(within(tableRow("אבי כהן")).getByRole("button", { name: "פעולות" })).toBeInTheDocument();
    expect(within(tableRow("אבי כהן")).getByText("Morning").closest("a")).toHaveAttribute(
      "href",
      "https://app.greeninvoice.co.il/incomes/clients/m1/documents"
    );
    expect(within(tableRow("בני לוי")).getByText("ללא")).toBeInTheDocument();
  });

  it("shows the table from 1024px (lg), the cards below it", () => {
    renderList();
    expect(table().closest(".lg\\:block")).not.toBeNull();
    expect(card("אבי כהן").closest(".lg\\:hidden")).not.toBeNull();
  });

  it("marks an inactive customer with a quiet grey 'לא פעיל' by the name — and an active one with nothing", () => {
    renderList();
    const inactive = within(tableRow("בני לוי")).getByText("לא פעיל");
    expect(inactive.className).toMatch(/text-\[0\.647rem\]/);
    expect(within(tableRow("אבי כהן")).queryByText("לא פעיל")).toBeNull();
    expect(within(tableRow("אבי כהן")).queryByText("פעיל")).toBeNull();
    expect(within(tableRow("בני לוי")).getByText("עובד")).toBeInTheDocument();
    expect(within(tableRow("בני לוי")).getByText("תשלום מראש")).toBeInTheDocument();
  });

  it("writes the debt ₪-first in whole shekels, in red, and '—' for none", () => {
    renderList();
    const debt = within(tableRow("אבי כהן")).getByText("₪1,357");
    expect(debt).toHaveClass("text-destructive");
    expect(debt).not.toHaveClass("whitespace-nowrap");
    expect(within(tableRow("בני לוי")).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("phone and email are the shared contact links", () => {
    renderList();
    expect(within(tableRow("אבי כהן")).getByText("050-1234567").closest("a")).toHaveAttribute("href", "tel:0501234567");
    expect(within(tableRow("אבי כהן")).getByText("avi@example.com").closest("a")).toHaveAttribute(
      "href",
      "mailto:avi@example.com"
    );
  });

  it("⋮ → עריכה opens the edit dialog with the row's own fields", () => {
    renderList();
    fireEvent.click(within(tableRow("אבי כהן")).getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /עריכה/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("עריכת אבי כהן");
    expect(dialog.last?.customer).toMatchObject({ id: "c1", name: "אבי כהן", notes: "לקוח ותיק" });
    expect(nav.router.push).not.toHaveBeenCalled();
  });

  it("⋮ → + הזמנה / + פרויקט open the new order / project for this customer", () => {
    renderList();
    fireEvent.click(within(tableRow("אבי כהן")).getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /\+ הזמנה/ }));
    expect(nav.router.push).toHaveBeenLastCalledWith("/sales/orders/new?customer_id=c1");
    fireEvent.click(within(tableRow("אבי כהן")).getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /\+ פרויקט/ }));
    expect(nav.router.push).toHaveBeenLastCalledWith("/projects?create=1&customer_id=c1");
  });

  it("opens a customer with a client navigation, and fetches it ahead when the mouse rests on its row", async () => {
    renderList();
    const row = tableRow("אבי כהן");
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    await waitFor(() => expect(nav.router.prefetch).toHaveBeenCalledWith("/customers/c1", expect.anything()));
    fireEvent.click(row);
    expect(nav.router.push).toHaveBeenCalledWith("/customers/c1");
  });
});

describe("CustomersClient — the phone cards", () => {
  it("are the list card's parts: name, a plain number, the green call button, the debt as חוב פתוח", () => {
    renderList();
    const body = card("אבי כהן");
    expect(within(body).getByText("אבי כהן")).toHaveClass("text-sm", "font-semibold");
    const number = within(body).getByText("050-1234567");
    // Plain text — not a tap zone or link of its own.
    expect(number.closest("a,[role='button']")).toBeNull();
    expect(within(body).getByRole("link", { name: "חיוג אל אבי כהן" })).toHaveAttribute("href", "tel:0501234567");
    expect(within(body).getByText("חוב פתוח ₪1,357")).toHaveClass("text-destructive");
    expect(within(body).getByText("3 הזמנות").className).toMatch(/text-\[0\.647rem\]/);
    // rounded-card from SwipeActions, the four sections' corner — not rounded-2xl.
    expect(body.closest(".rounded-card")).not.toBeNull();
    expect(body.closest(".rounded-2xl")).toBeNull();
  });

  it("shows the inactive pill by the name and opens the customer on a tap", () => {
    renderList();
    const body = card("בני לוי");
    expect(within(body).getByText("לא פעיל")).toBeInTheDocument();
    expect(within(body).queryByRole("link", { name: /חיוג/ })).toBeNull();
    fireEvent.click(body);
    expect(nav.router.push).toHaveBeenCalledWith("/customers/c2");
  });
});

describe("CustomersClient — filters and export", () => {
  it("everywhere: the toggle says סינון, reads ON when open, and drops the overlay under the sticky header", () => {
    renderList();
    // The phone strip's and the md+ toolbar's — the same toggle, two sizes.
    const toggle = screen.getAllByRole("button", { name: "סינון", expanded: false })[0];
    expect(toggle.className).not.toMatch(/bg-secondary /);
    fireEvent.click(toggle);
    const open = screen.getAllByRole("button", { name: "הסתרת סינון" });
    expect(open[0]).toHaveAttribute("aria-expanded", "true");
    expect(open[0].className).toMatch(/bg-secondary/);
    const overlay = document.getElementById("customers-filters-overlay")!;
    expect(overlay.className).toContain("top-[calc(60px+var(--page-sticky-h,0px))]");
    expect(overlay.className).not.toContain("top-[112px]");
    // The kit's close button, a full tap target.
    expect(within(overlay).getByRole("button", { name: "סגירת סינון" })).toHaveClass("h-11", "w-11");
  });

  it("a tablet has the search, the filter toggle, the export and the count too (md, not lg)", () => {
    renderList();
    const search = screen.getByLabelText("חיפוש לקוחות", { selector: "#customers-search" });
    const toolbar = search.closest(".md\\:grid")!;
    expect(toolbar.className).not.toContain("lg:grid");
    expect(within(toolbar as HTMLElement).getByRole("link", { name: /ייצוא לאקסל/ })).toBeInTheDocument();
    expect(screen.getByText("סה״כ 2 לקוחות").closest(".md\\:flex")).not.toBeNull();
  });

  it("changing a filter puts it in the address", () => {
    renderList();
    fireEvent.click(screen.getAllByRole("button", { name: "סינון" })[0]);
    fireEvent.change(document.getElementById("customers-filter-withDebt-inline")!, { target: { value: "yes" } });
    expect(nav.router.push).toHaveBeenCalledWith("/customers?with_debt=yes", { scroll: false });
  });

  it("with no connection a filter change says so instead of failing silently", () => {
    net.online = false;
    renderList();
    fireEvent.click(screen.getAllByRole("button", { name: "סינון" })[0]);
    fireEvent.change(document.getElementById("customers-filter-withOrders-inline")!, { target: { value: "no" } });
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("אין חיבור — אפשר לסנן כשיחזור החיבור.");
  });

  it("a closed panel with a filter on shows what it narrows by, and clears it", () => {
    renderList({ filters: { ...NO_CUSTOMERS_FILTERS, withDebt: "yes", activeOnly: "no" } });
    expect(screen.getByText("חוב פתוח: עם חוב פתוח • סטטוס: לא פעילים")).toBeInTheDocument();
    // On while a filter narrows the list, even with the panel shut.
    expect(screen.getAllByRole("button", { name: "סינון" })[0].className).toMatch(/bg-secondary/);
    expect(screen.getByText("סה״כ 2 לקוחות אחרי סינון")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "נקה סינון" }));
    expect(nav.router.push).toHaveBeenCalledWith("/customers", { scroll: false });
  });

  it("the export follows the filter on, and says 'אין חיבור' offline instead of failing", () => {
    renderList({ filters: { ...NO_CUSTOMERS_FILTERS, withProjects: "yes" } });
    const links = screen.getAllByRole("link", { name: /ייצוא לאקסל/ });
    for (const link of links) expect(link).toHaveAttribute("href", "/api/customers/export?with_projects=yes");
    net.online = false;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[0].dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(toast.error).toHaveBeenCalledWith("אין חיבור — אפשר לייצא כשיחזור החיבור.");
  });
});

describe("CustomersClient — empty states", () => {
  it("no customers at all", () => {
    renderList({ rows: [] });
    expect(screen.getByText("אין לקוחות עדיין.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("a filter that matches nothing, with the way out", () => {
    renderList({ rows: [], filters: { ...NO_CUSTOMERS_FILTERS, withOrders: "yes" } });
    expect(screen.getByText("לא נמצאו לקוחות לפי הסינון.")).toBeInTheDocument();
    const clear = screen.getAllByRole("button", { name: "נקה סינון" });
    fireEvent.click(clear[clear.length - 1]);
    expect(nav.router.push).toHaveBeenCalledWith("/customers", { scroll: false });
  });

  it("a search that matches nothing, with the way out", async () => {
    index.entries = [indexEntry("c1", "אבי כהן")];
    renderList();
    fireEvent.change(screen.getByLabelText("חיפוש לקוחות", { selector: "#customers-search" }), { target: { value: "זזזז" } });
    expect(await screen.findByText("לא נמצאו לקוחות לפי החיפוש.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "נקה חיפוש" }));
    expect(screen.getByText("סה״כ 2 לקוחות")).toBeInTheDocument();
  });
});

describe("CustomersClient — search", { timeout: 20_000 }, () => {
  const MANY = Array.from({ length: 120 }, (_, i) => indexEntry(`s${String(i + 1).padStart(3, "0")}`, `לקוח ${String(i + 1).padStart(3, "0")}`));
  const enrichedFor = (ids: string[]) =>
    ids.map((id) => ({ customer_id: id, customer_name: `לקוח ${id.slice(1)}`, orders_count: 2, projects_count: 0, open_balance: 0, active: true }));

  it("loads the index when the box is focused (not at once)", () => {
    renderList();
    expect(index.load).not.toHaveBeenCalled();
    fireEvent.focus(screen.getByLabelText("חיפוש לקוחות", { selector: "#customers-search" }));
    expect(index.load).toHaveBeenCalled();
  });

  it("shows every match a page at a time — not a silent 50 — and placeholders, not zeros, until enriched", async () => {
    index.entries = MANY;
    actions.loadCustomerRowsByIds.mockImplementation(async (ids: string[]) => ({ rows: enrichedFor(ids), error: null }));
    renderList();
    fireEvent.change(screen.getByLabelText("חיפוש לקוחות", { selector: "#customers-search" }), { target: { value: "לקוח" } });

    expect(screen.getByText("נמצאו 120 לקוחות בחיפוש")).toBeInTheDocument();
    expect(screen.getByText("מציג 50 מתוך 120 לקוחות")).toBeInTheDocument();
    // Not enriched yet: no "0" counts painted in the table's number columns.
    const firstRow = tableRow("לקוח 001");
    expect(within(firstRow).queryByText("0")).toBeNull();
    expect(firstRow.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    await waitFor(() => expect(within(tableRow("לקוח 001")).getByText("2")).toBeInTheDocument());
    expect(actions.loadCustomerRowsByIds).toHaveBeenCalledWith(MANY.slice(0, 50).map((e) => e.id));

    scrollToBottom();
    await waitFor(() => expect(screen.getByText("מציג 100 מתוך 120 לקוחות")).toBeInTheDocument());
    expect(actions.loadCustomerRowsByIds).toHaveBeenLastCalledWith(MANY.slice(50, 100).map((e) => e.id));
    // The list's own pages are not what scrolling a search loads.
    expect(actions.loadMoreCustomers).not.toHaveBeenCalled();
  });

  it("keeps to the 'active' filter from the index, and never paints an inactive match as active", () => {
    index.entries = [indexEntry("a1", "דנה פעילה"), indexEntry("a2", "דנה ישנה", { active: false })];
    renderList({ filters: { ...NO_CUSTOMERS_FILTERS, activeOnly: "no" } });
    fireEvent.change(screen.getByLabelText("חיפוש לקוחות", { selector: "#customers-search" }), { target: { value: "דנה" } });
    expect(within(table()).queryByText("דנה פעילה")).toBeNull();
    expect(within(tableRow("דנה ישנה")).getByText("לא פעיל")).toBeInTheDocument();
  });

  it("checks the orders / projects / debt filters on the server before showing matches", async () => {
    index.entries = [indexEntry("d1", "דוד חייב"), indexEntry("d2", "דוד שילם")];
    actions.findCustomerIdsPassingFilters.mockResolvedValue({ ids: ["d1"], error: null });
    const filters = { ...NO_CUSTOMERS_FILTERS, withDebt: "yes" as const };
    renderList({ filters });
    fireEvent.change(screen.getByLabelText("חיפוש לקוחות", { selector: "#customers-search" }), { target: { value: "דוד" } });
    expect(screen.getByText("מחפש…")).toBeInTheDocument();
    await waitFor(() => expect(within(table()).getByText("דוד חייב")).toBeInTheDocument());
    expect(within(table()).queryByText("דוד שילם")).toBeNull();
    expect(actions.findCustomerIdsPassingFilters).toHaveBeenCalledWith(["d1", "d2"], filters);
    expect(screen.getByText("נמצאו 1 לקוחות בחיפוש")).toBeInTheDocument();
  });

  it("an edit opened on a match the server hasn't filled in reads the customer first (no blanked notes)", async () => {
    index.entries = [indexEntry("e1", "אלי")];
    core.fetchCustomerCore.mockResolvedValue({ id: "e1", name: "אלי", notes: "הערה חשובה", active: true, linked_user_id: null });
    renderList();
    fireEvent.change(screen.getByLabelText("חיפוש לקוחות", { selector: "#customers-search" }), { target: { value: "אלי" } });
    fireEvent.click(within(tableRow("אלי")).getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /עריכה/ }));
    await screen.findByRole("dialog");
    expect(core.fetchCustomerCore).toHaveBeenCalledWith("e1");
    expect(dialog.last?.customer).toMatchObject({ id: "e1", notes: "הערה חשובה" });
  });
});

describe("CustomersClient — loading more", { timeout: 20_000 }, () => {
  const PAGE_ONE = Array.from({ length: 50 }, (_, i) => ({ ...AVI, customer_id: `p${i}`, customer_name: `לקוח ${i}` }));

  it("offline: says 'אין חיבור' and asks for nothing — no loop", () => {
    net.online = false;
    renderList({ rows: PAGE_ONE, hasMore: true, totalCount: 80 });
    scrollToBottom();
    expect(actions.loadMoreCustomers).not.toHaveBeenCalled();
    expect(screen.getByText("אין חיבור — שאר הלקוחות ייטענו כשיחזור החיבור.")).toBeInTheDocument();
  });

  it("a failed page shows the error with a retry, and doesn't ask again by itself at once", async () => {
    actions.loadMoreCustomers.mockResolvedValueOnce({ rows: [], hasMore: true, error: "אירעה שגיאה. נסו שוב." });
    renderList({ rows: PAGE_ONE, hasMore: true, totalCount: 80 });
    scrollToBottom();
    expect(await screen.findByText("אירעה שגיאה. נסו שוב.")).toBeInTheDocument();
    scrollToBottom();
    expect(actions.loadMoreCustomers).toHaveBeenCalledTimes(1);

    actions.loadMoreCustomers.mockResolvedValueOnce({
      rows: [{ ...AVI, customer_id: "p50", customer_name: "לקוח 50" }],
      hasMore: false,
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    await waitFor(() => expect(screen.getByText("מציג 51 מתוך 80 לקוחות")).toBeInTheDocument());
    expect(actions.loadMoreCustomers).toHaveBeenLastCalledWith(2, NO_CUSTOMERS_FILTERS);
  });
});

describe("CustomersClient — edits and refreshes keep the list where it is", { timeout: 20_000 }, () => {
  const PAGE_ONE = Array.from({ length: 50 }, (_, i) => ({
    ...AVI,
    customer_id: `p${String(i).padStart(2, "0")}`,
    customer_name: `לקוח ${String(i).padStart(2, "0")}`,
  }));

  async function scrolledList() {
    actions.loadMoreCustomers.mockResolvedValueOnce({
      rows: [{ ...AVI, customer_id: "p50", customer_name: "לקוח 50" }],
      hasMore: false,
      error: null,
    });
    const view = renderList({ rows: PAGE_ONE, hasMore: true, totalCount: 51 });
    scrollToBottom();
    await waitFor(() => expect(screen.getByText("מציג 51 מתוך 51 לקוחות")).toBeInTheDocument());
    return view;
  }

  it("a save patches its row in place — and one waiting for the connection says so", async () => {
    await scrolledList();
    fireEvent.click(within(tableRow("לקוח 50")).getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /עריכה/ }));
    act(() => dialog.last!.onSaved({ customer: { id: "p50", name: "לקוח חמישים", active: true }, contacts: [], queued: true }));
    expect(within(table()).getByText("לקוח חמישים")).toBeInTheDocument();
    expect(within(tableRow("לקוח חמישים")).getByText("ממתין לשליחה")).toBeInTheDocument();
    expect(screen.getByText("מציג 51 מתוך 51 לקוחות")).toBeInTheDocument();
    expect(nav.router.refresh).not.toHaveBeenCalled();
  });

  it("an undo patches the row back in place instead of refreshing the page", async () => {
    await scrolledList();
    fireEvent.click(within(tableRow("לקוח 50")).getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /עריכה/ }));
    act(() => dialog.last!.onSaved({ customer: { id: "p50", name: "שם חדש", active: true }, contacts: [] }));
    act(() => dialog.last!.onUndone!({ customer: { id: "p50", name: "לקוח 50", active: true }, contacts: [] }));
    expect(within(table()).getByText("לקוח 50")).toBeInTheDocument();
    expect(screen.getByText("מציג 51 מתוך 51 לקוחות")).toBeInTheDocument();
    expect(nav.router.refresh).not.toHaveBeenCalled();
  });

  it("a refresh of the same filters (a customer created) is merged in, in name order, keeping the pages scrolled in", async () => {
    const view = await scrolledList();
    const created = { ...AVI, customer_id: "new", customer_name: "לקוח 00א" };
    view.rerenderWith({ rows: [PAGE_ONE[0], created, ...PAGE_ONE.slice(1, 49)], hasMore: true, totalCount: 52 });
    const names = within(table())
      .getAllByRole("link")
      .filter((el) => el.tagName === "TR")
      .map((el) => el.querySelector("span.font-medium")?.textContent);
    expect(names.slice(0, 3)).toEqual(["לקוח 00", "לקוח 00א", "לקוח 01"]);
    // The page scrolled in is still there.
    expect(within(table()).getByText("לקוח 50")).toBeInTheDocument();
    expect(screen.getByText("מציג 52 מתוך 52 לקוחות")).toBeInTheDocument();
  });

  it("other filters start the list over", async () => {
    const view = await scrolledList();
    view.rerenderWith({ rows: [BENNY], filters: { ...NO_CUSTOMERS_FILTERS, activeOnly: "no" } });
    expect(within(table()).queryByText("לקוח 50")).toBeNull();
    expect(within(table()).getByText("בני לוי")).toBeInTheDocument();
  });
});

describe("CustomersClient — the rest of the way", { timeout: 20_000 }, () => {
  const search = (value: string) =>
    fireEvent.change(screen.getByLabelText("חיפוש לקוחות", { selector: "#customers-search" }), { target: { value } });

  it("a customer created elsewhere (the index reloads with a new id) is put in where it sorts", async () => {
    index.entries = [indexEntry("c1", "אבי כהן"), indexEntry("c2", "בני לוי")];
    const view = renderList();
    actions.loadCustomerRowsByIds.mockResolvedValue({
      rows: [{ ...AVI, customer_id: "c3", customer_name: "אבי ב" }],
      error: null,
    });
    index.entries = [...(index.entries as IndexEntry[]), indexEntry("c3", "אבי ב")];
    view.rerenderWith({ rows: [AVI, BENNY] });
    await waitFor(() => expect(within(table()).getByText("אבי ב")).toBeInTheDocument());
    expect(actions.loadCustomerRowsByIds).toHaveBeenCalledWith(["c3"], NO_CUSTOMERS_FILTERS);
    const names = Array.from(table().querySelectorAll("tbody tr td:first-child span.font-medium")).map((el) => el.textContent);
    expect(names).toEqual(["אבי ב", "אבי כהן", "בני לוי"]);
  });

  it("a save that waited is read again from the server once the queue has sent it", async () => {
    renderList();
    fireEvent.click(within(tableRow("אבי כהן")).getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /עריכה/ }));
    act(() => dialog.last!.onSaved({ customer: { id: "c1", name: "אבי כהן", active: true }, contacts: [], queued: true }));
    expect(within(tableRow("אבי כהן")).getByText("ממתין לשליחה")).toBeInTheDocument();
    actions.loadCustomerRowsByIds.mockResolvedValue({ rows: [{ ...AVI, customer_name: "אבי כהן" }], error: null });
    act(() => {
      window.dispatchEvent(new Event("biz:conn-synced"));
    });
    await waitFor(() => expect(within(tableRow("אבי כהן")).queryByText("ממתין לשליחה")).toBeNull());
    expect(actions.loadCustomerRowsByIds).toHaveBeenCalledWith(["c1"]);
  });

  it("offline, a search under an orders / projects / debt filter shows the matches and says the filter wasn't applied", () => {
    net.online = false;
    index.entries = [indexEntry("d1", "דוד")];
    renderList({ filters: { ...NO_CUSTOMERS_FILTERS, withProjects: "yes" } });
    search("דוד");
    expect(within(table()).getByText("דוד")).toBeInTheDocument();
    expect(screen.getByText(/אין חיבור — הסינון לא הוחל על החיפוש/)).toBeInTheDocument();
    expect(actions.findCustomerIdsPassingFilters).not.toHaveBeenCalled();
  });

  it("a failed filter check says so instead of showing nothing", async () => {
    index.entries = [indexEntry("d1", "דוד")];
    actions.findCustomerIdsPassingFilters.mockRejectedValue(new Error("boom"));
    renderList({ filters: { ...NO_CUSTOMERS_FILTERS, withOrders: "yes" } });
    search("דוד");
    // In the list's place (and on the md+ count line) — not the list, dimmed, under it.
    expect((await screen.findAllByText("החיפוש נכשל. נסו שוב.")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "נקה חיפוש" })).toBeInTheDocument();
  });

  it("says when the search can't run at all", () => {
    index.error = "שגיאת טעינת רשימת הלקוחות";
    renderList();
    search("אבי");
    expect(screen.getAllByText("החיפוש לא זמין כרגע — רשימת הלקוחות לא נטענה.").length).toBe(2);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/מציג/)).toBeNull();
  });

  it("an edit on an unfilled match that can't be read says so, and opens nothing", async () => {
    index.entries = [indexEntry("e1", "אלי")];
    core.fetchCustomerCore.mockResolvedValue(null);
    renderList();
    search("אלי");
    fireEvent.click(within(tableRow("אלי")).getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /עריכה/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("טעינת הלקוח נכשלה. נסו שוב."));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the filter overlay closes on Escape and on the backdrop", () => {
    renderList();
    fireEvent.click(screen.getAllByRole("button", { name: "סינון" })[0]);
    expect(document.getElementById("customers-filters-overlay")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.getElementById("customers-filters-overlay")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "סינון" })[0]);
    const backdrop = screen.getAllByRole("button", { name: "סגירת סינון" }).find((el) => el.className.includes("bg-black/30"))!;
    fireEvent.click(backdrop);
    expect(document.getElementById("customers-filters-overlay")).toBeNull();
  });

  it("the card's swipe holds the same three: a project, an order, the edit", () => {
    renderList();
    const swipe = card("אבי כהן").closest("[data-swipe-owner]") as HTMLElement;
    // The tiles sit under the card (aria-hidden until it's swiped open).
    const tile = (name: string) => within(swipe).getByRole("button", { name, hidden: true });
    fireEvent.click(tile("פרויקט"));
    expect(nav.router.push).toHaveBeenLastCalledWith("/projects?create=1&customer_id=c1");
    fireEvent.click(tile("הזמנה"));
    expect(nav.router.push).toHaveBeenLastCalledWith("/sales/orders/new?customer_id=c1");
    fireEvent.click(tile("עריכה"));
    expect(screen.getByRole("dialog")).toHaveTextContent("עריכת אבי כהן");
  });

  it("the 'offline copy' pill sits in lines that are already there", () => {
    index.stale = true;
    renderList();
    const pills = screen.getAllByText(/לא מקוון/);
    expect(pills.length).toBe(2);
    for (const pill of pills) expect(pill.closest(".min-h-6")).not.toBeNull();
  });
});

describe("CustomersClient — the top bar", () => {
  it("names the page with the server's count", () => {
    renderList({ totalCount: 655 });
    expect(screen.getByTestId("title")).toHaveTextContent("לקוחות / 655 לקוחות");
  });
});

describe("mergeFirstPage", () => {
  it("a complete first page is the whole list, but keeps an edit still waiting to be sent", () => {
    const waiting = { ...AVI, customer_name: "אבי (נשמר)", _sync_pending: true };
    const merged = mergeFirstPage([waiting, BENNY], [AVI], false);
    expect(merged).toEqual([waiting]);
  });
});
