// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// אנשי קשר וסניפים on the customer page: a contact added shows at once — with
// no connection too, marked as waiting, where it used to vanish until a page
// reload — one removed from its quiet ⋮ moves to the inactive list at once,
// and the inactive ones are a quiet grey pill, not a red box. Every phone,
// WhatsApp, email and address is its app's link, a finger's size.

const h = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (..._args: unknown[]) => ({ queued: false as const, ok: true as const, data: {} as unknown })),
  scheduleDeferredAction: vi.fn(),
  registerReversibleCreate: vi.fn(),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: h.offlineFetch, CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredAction: h.scheduleDeferredAction,
  registerReversibleCreate: h.registerReversibleCreate,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: React.ReactNode };
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
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children, onSelect }: Children & { onSelect?: () => void }) => (
      <div role="menuitem" onClick={() => onSelect?.()}>
        {children}
      </div>
    ),
  };
});

import { refresh } from "@/__tests__/mocks/next-navigation";
import CustomerContactsSection from "@/app/(app)/customers/[id]/CustomerContactsSection";
import type { CustomerContactRow } from "@/app/(app)/customers/[id]/customerPageModel";

function contact(id: string, overrides: Partial<CustomerContactRow> = {}): CustomerContactRow {
  return {
    id,
    fullName: `איש קשר ${id}`,
    role: null,
    phone: null,
    email: null,
    whatsapp: null,
    isPrimary: false,
    active: true,
    notes: null,
    ...overrides,
  };
}

function renderSection(contacts: CustomerContactRow[] = [], onEditCustomer = vi.fn()) {
  return render(
    <CustomerContactsSection
      customerId="c1"
      customerName="חברת אלון"
      contacts={contacts}
      branches={[{ id: "b1", name: "סניף צפון", address: "העצמאות 3, עכו", phone: "04-9999999" }]}
      onEditCustomer={onEditCustomer}
    />
  );
}

async function addContact(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "הוספת איש קשר" }));
  const dialog = await screen.findByRole("dialog", { name: "הוספת איש קשר" });
  fireEvent.change(within(dialog).getAllByRole("textbox")[0]!, { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("button", { name: "יצירת איש קשר" }));
}

beforeEach(() => {
  h.offlineFetch.mockReset().mockResolvedValue({ queued: false, ok: true, data: {} });
  h.scheduleDeferredAction.mockReset();
  h.registerReversibleCreate.mockReset();
  refresh.mockClear();
});

describe("CustomerContactsSection", () => {
  it("each phone, WhatsApp, email and address is its app's link, a finger's size", () => {
    renderSection([
      contact("k1", { fullName: "רונית", role: "הנהלת חשבונות", phone: "052-1111111", whatsapp: "052-1111111", email: "very.long.address.for.accounting@alon-industries.co.il", isPrimary: true }),
    ]);
    const phone = screen.getAllByText("052-1111111").map((node) => node.closest("a")!);
    expect(phone.map((link) => link.getAttribute("href"))).toEqual(["tel:0521111111", "https://wa.me/972521111111"]);
    for (const link of phone) expect(link.className).toContain("min-h-10");
    const email = screen.getByText("very.long.address.for.accounting@alon-industries.co.il");
    expect(email.className).toContain("break-all");
    expect(email.closest("a")).toHaveAttribute("href", "mailto:very.long.address.for.accounting@alon-industries.co.il");
    expect(screen.getByText("ראשי")).toBeInTheDocument();
    expect(screen.getByText("העצמאות 3, עכו").closest("a")).toHaveAttribute("href", expect.stringContaining("waze.com"));
    // The count: one contact and one branch.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("a contact added with no connection shows at once, marked as waiting", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    renderSection();
    expect(screen.getByText("אין אנשי קשר ללקוח זה.")).toBeInTheDocument();
    await addContact("משה");
    const name = await screen.findByText("משה");
    const row = name.closest("div.py-2\\.5") as HTMLElement;
    expect(within(row).getByText("ממתין לשליחה")).toBeInTheDocument();
    // No ⋮ on a row the server hasn't numbered yet.
    expect(within(row).queryByRole("button", { name: "פעולות" })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a contact added online shows at once, with its undo — the page isn't read again", async () => {
    h.offlineFetch.mockResolvedValueOnce({
      queued: false,
      ok: true,
      data: { contact: { id: "k9", full_name: "משה", phone: "0501234567" } },
    });
    renderSection();
    await addContact("משה");
    expect(await screen.findByText("משה")).toBeInTheDocument();
    expect(screen.queryByText("ממתין לשליחה")).toBeNull();
    expect(h.registerReversibleCreate).toHaveBeenCalledWith(expect.objectContaining({ scope: "customer-contact", id: "k9" }));
    expect(refresh).not.toHaveBeenCalled();

    // Undone: the contact goes to the inactive list.
    const undo = h.registerReversibleCreate.mock.calls[0]![0] as { onUndo: () => Promise<{ ok: boolean }> };
    await act(async () => {
      await undo.onUndo();
    });
    expect(screen.getByText("לא פעילים")).toBeInTheDocument();
    expect(h.offlineFetch).toHaveBeenLastCalledWith(
      "/api/customer-contacts/update",
      { id: "k9", active: false, is_primary: false },
      "ביטול הוספת איש קשר"
    );
  });

  it("removing a contact from its ⋮ moves it to the inactive list at once; undo brings it back", async () => {
    renderSection([contact("k1", { fullName: "רונית", phone: "052-1111111" })]);
    fireEvent.click(screen.getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByText("מחיקה"));
    const action = h.scheduleDeferredAction.mock.calls[0]![0] as {
      onApplyOptimistic: () => void;
      onRevert: () => void;
      onCommit: () => Promise<{ ok: boolean }>;
    };
    act(() => action.onApplyOptimistic());
    const inactive = screen.getByText("לא פעילים").parentElement as HTMLElement;
    expect(within(inactive).getByText("רונית")).toBeInTheDocument();
    // A quiet grey pill, not a red box.
    const badge = within(inactive).getByText("לא פעיל");
    expect(badge.className).toContain("bg-muted");
    expect(inactive.className).not.toContain("destructive");

    await expect(action.onCommit()).resolves.toEqual({ ok: true });
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/customer-contacts/update", { id: "k1", active: false, is_primary: false }, "הסרת איש קשר");

    act(() => action.onRevert());
    expect(screen.queryByText("לא פעילים")).toBeNull();
  });

  it("editing a contact or the branches opens the customer's edit dialog", () => {
    const onEdit = vi.fn();
    renderSection([contact("k1")], onEdit);
    fireEvent.click(screen.getByRole("button", { name: "פעולות" }));
    fireEvent.click(screen.getByText("עריכה"));
    fireEvent.click(screen.getByRole("button", { name: "עריכת סניפים" }));
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it("once the waiting contact has gone out, the page is read again and the real one takes its place", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    const { rerender } = renderSection();
    await addContact("משה");
    await screen.findByText("ממתין לשליחה");
    act(() => {
      window.dispatchEvent(new Event("biz:conn-synced"));
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    rerender(
      <CustomerContactsSection
        customerId="c1"
        customerName="חברת אלון"
        contacts={[contact("k-real", { fullName: "משה" })]}
        branches={[]}
        onEditCustomer={vi.fn()}
      />
    );
    expect(screen.getAllByText("משה")).toHaveLength(1);
    expect(screen.queryByText("ממתין לשליחה")).toBeNull();
  });
});
