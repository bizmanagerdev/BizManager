// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

// The projects list after the owner's decisions of 2026-10-11:
// - a phone card reads like the orders cards: the NAME first, the customer line
//   under it, the status pills below (it had the statuses on top);
// - the computer's table keeps its rows quiet: edit and delete behind a ⋮ at
//   the row's end, the delete still asking first ("מחיקה");
// - an empty list is the app's empty box, with "נקה סינון" when a search or a
//   filter is on (it said only "נמצאו 0 פרויקטים").

const nav = vi.hoisted(() => ({
  search: "view=projects",
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock("@/hooks/useInfiniteScroll", () => ({
  useInfiniteScroll: ({ initialRows }: { initialRows: unknown[] }) => {
    const [rows, setRows] = useState(initialRows);
    return { rows, setRows, hasMore: false, loading: false, sentinelRef: () => {}, mobileSentinelRef: () => {}, scrollRef: () => {} };
  },
}));
vi.mock("@/hooks/useOfflineRows", () => ({
  useOnline: () => true,
  useOfflineRows: (_key: string | null, rows: unknown[]) => ({ rows, offline: false, savedAt: null }),
}));
// One list each, like the real hooks' state (a new array on every render
// would re-run the list's search on every render).
const indexes = vi.hoisted(() => ({ customers: [] as unknown[], projects: [] as unknown[] }));
vi.mock("@/hooks/useCustomerSearchIndex", () => ({ useCustomerSearchIndex: () => ({ entries: indexes.customers }) }));
vi.mock("@/hooks/useProjectSearchIndex", () => ({
  useProjectSearchIndex: () => ({ entries: indexes.projects, loading: false }),
  searchProjectEntries: () => [],
}));
vi.mock("@/app/(app)/projects/actions", () => ({
  findProjectContentMatches: vi.fn(async () => ({ ids: [] })),
  loadMoreProjects: vi.fn(async () => ({ rows: [], hasMore: false })),
  loadProjectRowsByIds: vi.fn(async () => ({ rows: [] })),
}));
// The list on screen is current: nothing is fetched.
vi.mock("@/app/(app)/projects/projectsListCache", () => ({
  PROJECTS_FIRST_PAGE_FRESH_MS: 60_000,
  fetchProjectsFirstPage: vi.fn(async () => null),
  forgetOtherProjectsFirstPages: vi.fn(),
  getProjectsFirstPage: () => ({ rows: [], hasMore: false, totalCount: 0, at: Date.now() }),
  markOtherProjectsFirstPagesStale: vi.fn(),
  rememberProjectsFirstPage: vi.fn(),
}));
vi.mock("@/app/(app)/projects/NewProjectClient", () => ({ default: () => null }));
vi.mock("@/components/projects/ProjectStatusPicker", () => ({
  ProjectStatusPicker: ({ status, badgeClassName }: { status: string; badgeClassName?: string }) => (
    <span data-testid="status-pill" className={badgeClassName}>
      {status}
    </span>
  ),
}));
vi.mock("@/components/reminders/AddReminderButton", () => ({ default: () => null }));
vi.mock("@/components/communications/LogCommunicationButton", () => ({ default: () => null }));
vi.mock("@/lib/powersync/store", () => ({ whenDeviceSavesSent: vi.fn(async () => true) }));
vi.mock("@/lib/projects/device-project-saves", () => ({
  PROJECT_NOT_SENT_YET: "",
  deviceProjectForEdit: vi.fn(),
  deviceProjectSaves: vi.fn(),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: vi.fn(async () => ({ ok: true, queued: false, data: { ok: true } })) }));
const undo = vi.hoisted(() => ({ scheduleDeferredAction: vi.fn(), registerReversibleCreate: vi.fn() }));
vi.mock("@/lib/undo-engine", () => undo);
// The ⋮ menu inline, opened by a click (Radix's portal and pointer events
// aren't what's under test) — the same stand-in as ProjectTabsClient's tests.
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
    DropdownMenuItem: ({ children, onClick }: Children & { onClick?: () => void }) => {
      const { setOpen } = React.useContext(Menu);
      return (
        <div
          role="menuitem"
          onClick={() => {
            onClick?.();
            setOpen(false);
          }}
        >
          {children}
        </div>
      );
    },
  };
});

import ProjectsClient from "@/app/(app)/projects/ProjectsClient";
import { clearSharedSearch } from "@/lib/ui/shared-search";

const ROWS = [
  {
    id: "11111111-2222-4333-8444-555555555555",
    name: "הובלת משרד",
    status: "active",
    customer_name: "דנה כהן",
    customer_phone: "050-1234567",
    start_date: "2026-10-12",
    payment_status_list: "unpaid",
  },
];

function renderList(rows: Array<Record<string, unknown>> = ROWS) {
  return render(
    <ProjectsClient
      initialProjects={rows}
      customerOptions={[]}
      managerOptions={[]}
      viewerRole="admin"
      tabCounts={{ projects: rows.length, quotes: 0, closed: 0 }}
      initialFilters={{ view: "projects", status: "all", customerId: null, sort: "start_date_desc", q: "" }}
    />
  );
}

beforeEach(() => {
  nav.search = "view=projects";
  vi.clearAllMocks();
  // The search box is shared by the tabs; each test starts with it empty.
  clearSharedSearch("projects:");
});

describe("ProjectsClient — the phone card", () => {
  it("reads name first, the customer line under it, then the status pills, in the list card's parts", () => {
    renderList();
    // The card's, not the table row's.
    const name = screen.getAllByText("הובלת משרד").find((el) => !el.closest("tr"))!;
    const card = name.closest(".p-3")!;
    expect(card).not.toBeNull();
    expect(name).toHaveClass("text-sm", "font-semibold");
    const customer = within(card as HTMLElement).getByText(/דנה כהן/);
    expect(customer).toHaveClass("text-xs", "text-muted-foreground");
    const pill = within(card as HTMLElement).getByTestId("status-pill");
    expect(pill).toHaveClass("px-2", "py-0.5", "text-[0.647rem]");
    // In the card's own order: the name, then the customer, then the pills.
    const order = (a: Element, b: Element) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(name, customer)).toBeTruthy();
    expect(order(customer, pill)).toBeTruthy();
  });
});

describe("ProjectsClient — the computer's table", () => {
  it("edit and delete wait behind a ⋮ at the row's end; the delete asks first, in nouns", async () => {
    renderList();
    const table = screen.getByRole("table");
    // No pencil or bin on the row itself.
    expect(within(table).queryByRole("button", { name: "עריכת פרויקט" })).toBeNull();
    expect(within(table).queryByRole("button", { name: "מחיקת פרויקט" })).toBeNull();

    const row = within(table).getByText("הובלת משרד").closest("tr")!;
    const more = within(row).getByRole("button", { name: "פעולות" });
    // At the row's end: its last cell.
    expect(more.closest("td")).toBe(row.lastElementChild);
    fireEvent.click(more);
    const menu = within(row).getByRole("menu");
    expect(within(menu).getByText("עריכת פרויקט")).toBeInTheDocument();
    fireEvent.click(within(menu).getByText("מחיקה"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("למחוק את הובלת משרד?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    expect(undo.scheduleDeferredAction).toHaveBeenCalledWith(
      expect.objectContaining({ key: "project:delete:11111111-2222-4333-8444-555555555555" })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a row opens its project on click, and resting the mouse on it loads nothing ahead (removed 2026-10-29)", async () => {
    renderList();
    const row = within(screen.getByRole("table")).getByText("הובלת משרד").closest("tr")!;
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    // Past the 100 ms rest that used to load the page.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(nav.router.prefetch).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(nav.router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/projects\//));
  });
});

describe("ProjectsClient — an empty list", () => {
  it("the app's empty box; with a search or a filter on, 'נקה סינון' clears it", () => {
    nav.search = "view=projects&status=on_hold";
    renderList([]);
    const box = screen.getByText("לא נמצאו פרויקטים לפי החיפוש.").closest(".border-dashed")!;
    expect(box).not.toBeNull();
    const clear = within(box as HTMLElement).getByRole("button", { name: "נקה סינון" });
    // Grey, like every clear / cancel.
    expect(clear).toHaveClass("bg-foreground/[0.06]");
    const pushState = vi.spyOn(window.history, "pushState");
    fireEvent.click(clear);
    // Back to the tab's plain list: no status in the address.
    expect(pushState).toHaveBeenCalledWith(null, "", "/projects");
    pushState.mockRestore();
  });

  it("with nothing on, it just says there's nothing", () => {
    renderList([]);
    const box = screen.getByText("אין פרויקטים.").closest(".border-dashed")!;
    expect(box).not.toBeNull();
    expect(within(box as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("the phone's filter panel clears with the same words", () => {
    renderList();
    expect(screen.getByRole("button", { name: "נקה סינון" })).toBeInTheDocument();
    expect(screen.queryByText("איפוס סינון")).toBeNull();
  });
});

describe("ProjectsClient — one search for every tab", () => {
  it("what's typed stays when the tab changes, and goes into the new tab's address (owner, 2026-10-19)", () => {
    renderList();
    const [box] = screen.getAllByPlaceholderText(/חיפוש/);
    fireEvent.change(box, { target: { value: "1447" } });
    const pushState = vi.spyOn(window.history, "pushState");
    fireEvent.mouseDown(screen.getAllByRole("tab", { name: /סגורים/ })[0]);
    expect(pushState).toHaveBeenCalledWith(null, "", "/projects?view=closed&q=1447");
    pushState.mockRestore();
    for (const input of screen.getAllByPlaceholderText(/חיפוש/)) expect((input as HTMLInputElement).value).toBe("1447");
  });
});

describe("ProjectsClient — the count while searching", () => {
  it("says how many the search found, out of the tab's total (owner, 2026-10-19)", () => {
    renderList();
    expect(screen.getByText("נמצאו 1 פרויקטים")).toBeInTheDocument();
    const [box] = screen.getAllByPlaceholderText(/חיפוש/);
    fireEvent.change(box, { target: { value: "אין כזה" } });
    expect(screen.getByText("לא נמצאו פרויקטים")).toBeInTheDocument();
    expect(screen.getByText(/\(מתוך 1 בפרויקטים\)/)).toBeInTheDocument();
    expect(screen.queryByText("נמצאו 1 פרויקטים")).toBeNull();
  });
});
