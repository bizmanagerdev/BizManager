// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The project page's actions (the pencil and the ⋮) after the owner's
// decisions of 2026-10-11:
// - in the ⋮, שיתוף and הדפסה are items of their own, as on the order page —
//   they sat one level down in a "שיתוף / הדפסה" submenu;
// - deleting a file from the edit dialog asks first, as every delete does — it
//   used to delete on the tap.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/layout/page-title-context", () => ({ useSetHeaderAction: () => {} }));
vi.mock("@/components/customers/CustomerPicker", () => ({ CustomerPicker: () => null }));
vi.mock("@/lib/ui/alerts-refresh", () => ({ resyncAlerts: vi.fn() }));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: vi.fn() }));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload: vi.fn() }));
vi.mock("@/lib/projects/device-project-saves", () => ({ deviceProjectSaves: vi.fn() }));
const share = vi.hoisted(() => ({ printProjectSheet: vi.fn(), projectShareHref: () => "https://wa.me/?text=x" }));
vi.mock("@/app/(app)/projects/[id]/ProjectShareActions", () => share);
// The ⋮ inline, opened by a click — the same stand-in as ProjectTabsClient's tests.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: React.ReactNode; asChild?: boolean };
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
    DropdownMenuItem: ({ children, onSelect }: Children & { onSelect?: () => void }) => (
      <div role="menuitem" onClick={() => onSelect?.()}>
        {children}
      </div>
    ),
  };
});

import ProjectDetailsActions from "@/app/(app)/projects/[id]/ProjectDetailsActions";

const PROJECT = {
  id: "proj-1",
  name: "הובלת משרד",
  customer_id: "c1",
  status: "active",
  project_type: "moving",
  agreed_base_price: 1000,
  actual_price: 1000,
  price_includes_vat: false,
  no_charge: false,
  expenses_billed_separately: false,
  project_manager_id: null,
  start_date: null,
  end_date: null,
  notes: null,
  items_to_move: [],
};

const DOC = {
  document_id: "d1",
  title: "חוזה",
  file_name: "contract.pdf",
  document_type: null,
  uploaded_at: null,
  uploaded_by_name: null,
  url: "https://files.example.test/contract.pdf",
};

function renderActions() {
  return render(
    <ProjectDetailsActions
      project={PROJECT}
      customerOptions={[]}
      managerOptions={[]}
      projectDocuments={[DOC]}
      projectDocumentsError={null}
      share={{} as never}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  share.printProjectSheet.mockClear();
});

describe("ProjectDetailsActions", () => {
  it("the ⋮ lists שיתוף and הדפסה as items of their own", () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "פעולות נוספות" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByText("שיתוף / הדפסה")).toBeNull();
    const items = within(menu).getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["דף עבודה", "שיתוף", "הדפסה", "מחיקת פרויקט"]);
    fireEvent.click(within(menu).getByText("הדפסה"));
    expect(share.printProjectSheet).toHaveBeenCalled();
  });

  it("deleting a file from the edit dialog asks first, and only then deletes it", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
    const edit = await screen.findByRole("dialog");
    // The shared Field: the required ones carry the red "*".
    expect(within(edit).getByText("שם פרויקט").querySelector(".text-destructive")?.textContent).toBe(" *");

    fireEvent.click(within(edit).getByRole("button", { name: "מחיקת מסמך" }));
    const confirm = await screen.findByRole("dialog", { name: "מחיקת מסמך" });
    expect(within(confirm).getByText("למחוק את חוזה?")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "מחיקה" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/documents/delete", expect.anything()));
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ document_id: "d1" });
  });

  it("cancelling the question keeps the file", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
    const edit = await screen.findByRole("dialog");
    fireEvent.click(within(edit).getByRole("button", { name: "מחיקת מסמך" }));
    const confirm = await screen.findByRole("dialog", { name: "מחיקת מסמך" });
    fireEvent.click(within(confirm).getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "מחיקת מסמך" })).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("חוזה")).toBeInTheDocument();
  });
});
