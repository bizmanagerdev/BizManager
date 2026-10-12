// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// The recurring task templates after the owner's decisions of 2026-10-11: a
// big list — swipe on the phone, a ⋮ at the row's end on the computer (it had
// a pencil and a bin on every row); the orders table's shell and density; the
// phone card in the list card's parts; an empty list in the app's empty box.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/useUndoOverlay", () => ({ useUndoOverlay: <T,>(rows: T[]) => rows }));
const undo = vi.hoisted(() => ({
  scheduleDeferredDelete: vi.fn(),
  scheduleDeferredEdit: vi.fn(),
  registerReversibleCreate: vi.fn(),
}));
vi.mock("@/lib/undo-engine", () => undo);
vi.mock("@/lib/recurring/deleteTemplate", () => ({ deleteRecurringTaskTemplate: vi.fn() }));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: vi.fn() }));
vi.mock("@/components/financial/DomainSelect", () => ({ DomainSelect: () => null }));
// The ⋮ inline, opened by a click — the same stand-in as ProjectTabsClient's tests.
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
    DropdownMenuItem: ({ children, onClick }: Children & { onClick?: () => void }) => (
      <div role="menuitem" onClick={() => onClick?.()}>
        {children}
      </div>
    ),
  };
});

import RecurringTasksClient from "@/app/(app)/tasks/recurring/RecurringTasksClient";

const TEMPLATE = {
  id: "tpl-1",
  subject_template: "תשלום חשמל",
  description_template: null,
  business_domain: "general_business",
  project_id: null,
  property_id: null,
  default_priority: "medium" as const,
  default_status: "todo" as const,
  create_day_of_month: 1,
  due_day_of_month: 10,
  start_date: null,
  end_date: null,
  is_active: true,
  assignee_user_ids: [],
};

function renderList(templates = [TEMPLATE]) {
  return render(
    <RecurringTasksClient templates={templates} projects={[]} properties={[]} users={[]} hideHeader />
  );
}

beforeEach(() => vi.clearAllMocks());

describe("RecurringTasksClient", () => {
  it("the computer's table: the orders table's density, and edit / delete behind a ⋮ at the row's end", () => {
    renderList();
    const table = screen.getByRole("table");
    expect(within(table).getByText("משימה קבועה")).toHaveClass("px-4", "py-3");
    const row = within(table).getByText("תשלום חשמל").closest("tr")!;
    expect(row.firstElementChild).toHaveClass("px-4", "py-4");
    // No pencil or bin on the row itself.
    expect(within(row).queryByRole("button", { name: "עריכה" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "מחיקה" })).toBeNull();

    const more = within(row).getByRole("button", { name: "פעולות" });
    expect(more.closest("td")).toBe(row.lastElementChild);
    fireEvent.click(more);
    const menu = within(row).getByRole("menu");
    expect(within(menu).getByText("עריכה")).toBeInTheDocument();
    fireEvent.click(within(menu).getByText("מחיקה"));

    // Asks first.
    const dialog = screen.getByRole("dialog", { name: "מחיקת משימה קבועה" });
    expect(undo.scheduleDeferredDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    expect(undo.scheduleDeferredDelete).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "recurring-task-template", id: "tpl-1" })
    );
  });

  it("the phone card: the name first in the list card's parts, the swipe hint above", () => {
    renderList();
    expect(screen.getByText("החלק כרטיס ימינה לעריכה ומחיקה")).toBeInTheDocument();
    const name = screen.getAllByText("תשלום חשמל").find((el) => !el.closest("tr"))!;
    expect(name).toHaveClass("text-sm", "font-semibold", "leading-snug");
    expect(name.closest("button")).toHaveClass("p-3");
  });

  it("no templates: the app's empty box", () => {
    renderList([]);
    expect(screen.getByText(/אין עדיין משימות קבועות/).closest(".border-dashed")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
