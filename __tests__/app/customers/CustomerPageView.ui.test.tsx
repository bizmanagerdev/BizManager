// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

// The customer page (CustomerPageView) after the owner's decisions of
// 2026-10-13: one page like the project page — the name and a ⋮ in the top
// bar, a לקוח card and an always-present money card at the top, then sections
// that fold to their header line. And the delete that says up front why it
// can't happen. Everything that leaves the page is mocked at its module
// boundary: the send queue, the dialogs owned by other screens, the router.

const h = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() });
  return {
    toast,
    title: { current: null as null | { title: unknown; subtitle: unknown; action: unknown } },
    offlineFetch: vi.fn(async (..._args: unknown[]) => ({ queued: false as const, ok: true as const, data: {} })),
    fetchChecklistForEntity: vi.fn(async () => [] as unknown[]),
  };
});

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/layout/page-title-context", () => ({
  useSetPageTitle: (title: unknown, subtitle: unknown, action: unknown) => {
    h.title.current = { title, subtitle, action };
  },
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: h.offlineFetch, CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload: vi.fn() }));
vi.mock("@/lib/documents/checklist", () => ({ fetchChecklistForEntity: h.fetchChecklistForEntity }));
vi.mock("@/lib/documents/updateDocumentTag", () => ({ updateDocumentTag: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/hooks/useAssignableUsers", () => ({ useAssignableUsers: () => ({ users: [], currentUserId: "u1", loading: false }) }));
vi.mock("@/components/collections/AssigneeSelect", () => ({ AssigneeSelect: () => null }));
vi.mock("@/components/collections/CommunicationLogItem", () => ({
  default: ({ log }: { log: { content: string | null } }) => <div>{log.content}</div>,
}));
vi.mock("@/components/morning/MorningDocumentsPanel", () => ({ default: () => null }));
vi.mock("@/components/morning/MorningQuoteDialog", () => ({ default: () => <button type="button">הצעת מחיר חדשה</button> }));
vi.mock("@/app/(app)/activity/EntityActivityTimeline", () => ({
  default: ({ items }: { items: unknown[] }) => <div>רשומות: {items.length}</div>,
}));
vi.mock("@/components/customers/EditCustomerDialog", () => ({
  EditCustomerDialog: (props: {
    open: boolean;
    customer: { notes: string | null; active: boolean };
    onSaved: (payload: { customer: Record<string, unknown>; contacts: unknown[] }) => void;
  }) =>
    props.open ? (
      <div role="dialog" aria-label="עריכת פרטי לקוח">
        <span>הערות בטופס: {props.customer.notes ?? "אין"}</span>
        <span>פעיל בטופס: {String(props.customer.active)}</span>
        <button type="button" onClick={() => props.onSaved({ customer: { id: "c1", notes: "לתאם לפני משלוח" }, contacts: [] })}>
          שמירת לקוח
        </button>
      </div>
    ) : null,
}));
vi.mock("@/components/tasks/TaskUpsertDialog", () => ({
  TaskUpsertDialog: (props: { open: boolean; mode: string; onSaved?: (row?: Record<string, unknown> | null) => void }) =>
    props.open ? (
      <div role="dialog" aria-label={props.mode === "create" ? "משימה חדשה" : "עריכת משימה"}>
        <button
          type="button"
          onClick={() =>
            props.onSaved?.({
              id: "t-new",
              subject: "לחזור ללקוח",
              status: "todo",
              priority: "high",
              due_date: "2026-10-20",
              assigned_user_id: "u1",
              is_private: false,
            })
          }
        >
          שמירת משימה
        </button>
      </div>
    ) : null,
}));
// next/dynamic's loader resolves on a later tick; React.lazy + Suspense is the
// closest stand-in (ProjectTabsClient's tests do the same).
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<unknown>) => {
      const Lazy = React.lazy(async () => {
        const loaded = (await loader()) as { default?: React.ComponentType } & React.ComponentType;
        return { default: loaded.default ?? loaded };
      });
      return function Dynamic(props: Record<string, unknown>) {
        return (
          <React.Suspense fallback={null}>
            <Lazy {...props} />
          </React.Suspense>
        );
      };
    },
  };
});
// The ⋮ inline, opened by a click — the same stand-in as the project page's tests.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: React.ReactNode; asChild?: boolean; className?: string };
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
    DropdownMenuItem: ({ children, onSelect, asChild, className }: Children & { onSelect?: () => void }) => {
      const { setOpen } = React.useContext(Menu);
      return (
        <div
          role="menuitem"
          data-class={className}
          onClick={() => {
            onSelect?.();
            setOpen(false);
          }}
        >
          {asChild ? children : children}
        </div>
      );
    },
  };
});

import { push } from "@/__tests__/mocks/next-navigation";
import { mountTopBarSlots } from "@/__tests__/mocks/top-bar-slots";
import CustomerPageView from "@/app/(app)/customers/[id]/CustomerPageView";
import {
  NO_DOCUMENTS,
  NO_HISTORY,
  NO_PAYMENTS,
  makeTop,
  order,
  paymentRow,
  project,
  settled,
} from "@/__tests__/app/customers/customerPageFixtures";
import type { CustomerPageTop, CustomerPaymentsResult } from "@/app/(app)/customers/[id]/customerPageModel";

function renderPage(
  top: CustomerPageTop = makeTop(),
  {
    payments = settled(NO_PAYMENTS),
    role = "admin",
  }: { payments?: Promise<CustomerPaymentsResult>; role?: string } = {}
) {
  return render(
    <CustomerPageView
      top={top}
      payments={payments}
      documents={settled(NO_DOCUMENTS)}
      history={role === "admin" ? settled(NO_HISTORY) : null}
      viewer={{ id: "u1", role }}
      today="2026-10-13"
    />
  );
}

/** A section by its title — the CollapsibleSection card around it. */
function section(title: string) {
  const heading = screen.getAllByText(title).find((node) => node.closest("button[aria-expanded]"));
  if (!heading) throw new Error(`no section ${title}`);
  return heading.closest(".rounded-card") as HTMLElement;
}

function toggle(title: string) {
  return section(title).querySelector("button[aria-expanded]") as HTMLButtonElement;
}

/** The phone's ⋮, as the top bar shows it. */
async function openPhoneMenu() {
  // Let the page settle first (its task dialog's code arrives on a later tick).
  await act(async () => {});
  const action = h.title.current?.action as ReactNode;
  const utils = render(<>{action}</>);
  fireEvent.click(within(utils.container).getByRole("button", { name: "פעולות" }));
  return within(utils.container).getByRole("menu");
}

// The heading and its buttons go into the app's top bar (TopBarHeading).
let unmountSlots = () => {};
beforeEach(() => {
  unmountSlots = mountTopBarSlots();
  h.offlineFetch.mockClear();
  h.fetchChecklistForEntity.mockReset().mockResolvedValue([]);
  push.mockClear();
  h.toast.success.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, blocker: null }), { status: 200 })));
  window.location.hash = "";
});

afterEach(() => {
  vi.useRealTimers();
  unmountSlots();
});

describe("the top bar and the heading", () => {
  it("puts 'לקוח' over the customer's name in the top bar, with a ⋮ of everything you can do", async () => {
    renderPage();
    expect(h.title.current?.title).toBe("לקוח");
    expect(h.title.current?.subtitle).toBe("חברת אלון");
    const items = within(await openPhoneMenu())
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(items).toEqual(["עריכה", "הזמנה", "פרויקט", "משימה", "תיעוד שיחה", "תזכורת", "מחיקת לקוח"]);
  });

  it("the ⋮'s + הזמנה and + פרויקט start them for this customer", async () => {
    renderPage();
    const menu = await openPhoneMenu();
    expect(within(menu).getByText("הזמנה").closest("a")).toHaveAttribute("href", "/sales/orders/new?customer_id=c1");
    expect(within(menu).getByText("פרויקט").closest("a")).toHaveAttribute("href", "/projects?create=1&customer_id=c1");
  });

  it("names the customer once on a computer — the heading, with the pencil and a ⋮ — and no edit/delete icons in the card", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("חברת אלון");
    expect(screen.getAllByRole("button", { name: "עריכת לקוח" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "מחיקת לקוח" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "עריכת לקוח" }));
    expect(screen.getByRole("dialog", { name: "עריכת פרטי לקוח" })).toBeInTheDocument();
  });
});

describe("delete", () => {
  it("a customer with orders and projects can't be deleted: the ⋮ says why, and offers to mark them inactive", async () => {
    renderPage(makeTop({ orders: [order("o1"), order("o2")], projects: [project("p1")] }));
    const menu = await openPhoneMenu();
    expect(within(menu).getByText("לא ניתן — יש ללקוח 2 הזמנות ופרויקט אחד")).toBeInTheDocument();
    fireEvent.click(within(menu).getByText("מחיקת לקוח"));

    const dialog = await screen.findByRole("dialog", { name: "לא ניתן למחוק את הלקוח" });
    expect(dialog).toHaveTextContent("יש ללקוח 2 הזמנות ופרויקט אחד");
    expect(screen.queryByText("לא פעיל")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "סימון כלא פעיל" }));

    await waitFor(() =>
      expect(h.offlineFetch).toHaveBeenCalledWith("/api/customers/update", { id: "c1", active: false }, "סימון לקוח כלא פעיל")
    );
    // Shown at once, and the edit dialog opens with it (saving it won't undo it).
    expect(await screen.findByText("לא פעיל")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עריכת לקוח" }));
    expect(screen.getByText("פעיל בטופס: false")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a customer with nothing linked is asked about, checked once more with the server, then deleted with undo", async () => {
    renderPage();
    fireEvent.click(within(await openPhoneMenu()).getByText("מחיקת לקוח"));
    const dialog = await screen.findByRole("dialog", { name: "מחיקת לקוח" });
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/customers/delete",
      expect.objectContaining({ body: JSON.stringify({ id: "c1", dry_run: true }) })
    );
    expect(h.toast.success).toHaveBeenCalledWith("הלקוח נמחק", expect.anything());
  });

  it("stays on the page and says why when the server has found something linked since", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, blocker: "יש ללקוח הזמנה אחת" }), { status: 200 })
    );
    renderPage();
    fireEvent.click(within(await openPhoneMenu()).getByText("מחיקת לקוח"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "מחיקת לקוח" })).getByRole("button", { name: "מחיקה" }));
    const blocked = await screen.findByRole("dialog", { name: "לא ניתן למחוק את הלקוח" });
    expect(blocked).toHaveTextContent("יש ללקוח הזמנה אחת");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the top cards", () => {
  it("the money card is there with no debt too: ₪0 and 'אין חוב פתוח'", () => {
    renderPage(makeTop({ orders: [order("o1")] }));
    const label = screen.getByText("חוב פתוח");
    const card = label.closest(".rounded-card") as HTMLElement;
    expect(within(card).getByText("₪0")).toHaveClass("text-success-soft-foreground");
    expect(within(card).getByText("אין חוב פתוח")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "פעולות גבייה" })).toBeInTheDocument();
  });

  it("with a debt: the amount in red, partly paid, how late, the terms and the due date", () => {
    renderPage(
      makeTop({
        orders: [order("o1", { total: 1000, collected: 400, remaining: 600 })],
        collection: {
          logs: [],
          reminders: [],
          receivables: [
            {
              source_type: "order",
              source_id: "o1",
              collection_key: "order:o1",
              title: null,
              business_domain: null,
              reference_date: "2026-09-01",
              total_amount: 1000,
              collected_amount: 400,
              outstanding_amount: 600,
              pending_amount: 0,
              overdue_amount: 0,
              next_due_date: null,
              due_date: "2026-10-01",
              payment_terms: "net_30",
              days_late: 12,
              collection_status: "overdue",
              pending_payments: [],
            },
          ],
        },
      })
    );
    const card = screen.getByText("חוב פתוח").closest(".rounded-card") as HTMLElement;
    expect(within(card).getByText("₪600")).toHaveClass("text-destructive");
    expect(within(card).getByText("שולם חלקית")).toBeInTheDocument();
    expect(within(card).getByText("12 ימים")).toBeInTheDocument();
    expect(card).toHaveTextContent("₪400 מתוך ₪1,000");
    expect(card).toHaveTextContent("פירעון 01/10/26");
  });

  it("'פעילות אחרונה' fills in from the payments when they arrive", async () => {
    let deliver: (value: CustomerPaymentsResult) => void = () => {};
    const payments = new Promise<CustomerPaymentsResult>((resolve) => {
      deliver = resolve;
    });
    renderPage(makeTop({ orders: [order("o1", { date: "2026-09-01" })] }), { payments });
    const card = screen.getByText("חוב פתוח").closest(".rounded-card") as HTMLElement;
    expect(card).toHaveTextContent("פעילות אחרונה");
    expect(card).not.toHaveTextContent("01/09/26");
    await act(async () => deliver({ payments: [paymentRow("p1", { date: "2026-10-11" })], lastPaymentAt: "2026-10-11", error: null }));
    // The newer of the last order and the last payment, said the Hebrew way.
    expect(await within(card).findByText("11/10/26 (לפני יומיים)")).toBeInTheDocument();
  });

  it("the לקוח card: how to reach them, the green call, and what marks them", () => {
    renderPage(
      makeTop({
        customer: { whatsapp: "052-7654321", requiresPrepayment: true, invoiceName: "אלון בע״מ", registrationNumber: "512345678" },
        linkedWorker: { id: "w1", name: "יוסי" },
        tags: [{ id: "tag1", name: "VIP" }],
      })
    );
    const card = screen.getByText("לקוח", { selector: "div" }).closest(".rounded-card") as HTMLElement;
    expect(within(card).getByRole("link", { name: "חיוג אל חברת אלון" })).toHaveAttribute("href", "tel:0501234567");
    expect(within(card).getByText("052-7654321").closest("a")).toHaveAttribute("href", "https://wa.me/972527654321");
    expect(within(card).getByText("הרצל 5, חיפה").closest("a")).toHaveAttribute("href", expect.stringContaining("waze.com"));
    expect(within(card).getByText("עובד בעסק", { selector: "div" })).toBeInTheDocument();
    expect(within(card).getByText("תשלום מראש")).toBeInTheDocument();
    expect(within(card).getByText("יוסי").closest("a")).toHaveAttribute("href", "/payroll/workers/w1");
    expect(card).toHaveTextContent("שם לחשבונית: אלון בע״מ");
    expect(within(card).getByRole("button", { name: "הסרת תגית VIP" })).toBeInTheDocument();
  });
});

describe("the sections", () => {
  it("open when they hold what the reader came for; empty ones fold to the header with 0 and their +", () => {
    renderPage(makeTop({ orders: [order("o1"), order("o2")] }));
    expect(toggle("הזמנות")).toHaveAttribute("aria-expanded", "true");
    expect(within(section("הזמנות")).getByText("2")).toBeInTheDocument();
    expect(toggle("פרויקטים")).toHaveAttribute("aria-expanded", "false");
    expect(within(section("פרויקטים")).getByText("0")).toBeInTheDocument();
    expect(within(section("פרויקטים")).getByRole("link", { name: "פרויקט חדש ללקוח" })).toBeInTheDocument();
    // No separate "empty row" boxes: folded, it's just the header line.
    expect(screen.getByText("אין פרויקטים ללקוח זה.").closest(".hidden")).not.toBeNull();
    // The history is folded until asked for.
    expect(toggle("היסטוריית פעילות")).toHaveAttribute("aria-expanded", "false");
  });

  it("every '+' is the same soft button", () => {
    renderPage();
    const collection = section("גבייה ושיחות");
    const adds = [
      screen.getByRole("link", { name: "הזמנה חדשה ללקוח" }),
      screen.getByRole("link", { name: "פרויקט חדש ללקוח" }),
      within(collection).getAllByRole("button", { name: "תיעוד שיחה" }).find((button) => button.title === "תיעוד שיחה")!,
      // The panel's own "+"s, at the foot of the section.
      within(collection).getByRole("button", { name: "תזכורת" }),
      within(collection).getAllByRole("button", { name: "תיעוד שיחה" }).find((button) => !button.title)!,
      screen.getByRole("button", { name: "משימה חדשה ללקוח" }),
      screen.getByRole("button", { name: "הבטחת תשלום חדשה" }),
      screen.getByRole("button", { name: "הוספת איש קשר" }),
      screen.getByRole("button", { name: "העלאת מסמך" }),
      screen.getByRole("button", { name: "הוספת הערה" }),
    ];
    for (const add of adds) {
      expect(add.className).toContain("border-dashed");
      expect(add.className).toContain("h-8");
    }
    expect(new Set(adds.map((add) => add.className)).size).toBe(1);
  });

  it("the גבייה section opens when there's a debt or an open reminder", () => {
    renderPage(makeTop({ collection: { logs: [], reminders: [{ id: "r1", status: "pending", remind_at: "2026-10-20T08:00:00Z", content: "להתקשר", action_type: "call" } as never], receivables: [] } }));
    expect(toggle("גבייה ושיחות")).toHaveAttribute("aria-expanded", "true");
    expect(within(section("גבייה ושיחות")).getByText("להתקשר")).toBeInTheDocument();
  });

  it("the payments' count is all of them; ten are listed", () => {
    const payments = Array.from({ length: 12 }, (_, i) => paymentRow(`p${i}`, { amount: 10 + i }));
    renderPage(makeTop(), { payments: settled({ payments, lastPaymentAt: null, error: null }) });
    const box = section("תשלומים אחרונים");
    expect(within(box).getByText("12")).toBeInTheDocument();
    expect(within(box).getAllByText("נגבה")).toHaveLength(10);
    expect(within(box).getByRole("link", { name: "לכל התנועות במידע הפיננסי" })).toBeInTheDocument();
  });

  it("'מסמכים נדרשים' shows when nothing is filed yet", async () => {
    h.fetchChecklistForEntity.mockResolvedValue([
      { code: "contract", label: "חוזה", present: false, documentId: null, validUntil: null },
    ]);
    renderPage();
    expect(await within(section("מסמכים")).findByText("מסמכים נדרשים")).toBeInTheDocument();
    expect(within(section("מסמכים")).getByText("אין מסמכים ללקוח זה.")).toBeInTheDocument();
  });

  it("a lease with no start date says nothing of when it started (not 'החל מ--')", () => {
    renderPage(
      makeTop({
        leases: [
          { id: "l1", propertyId: "pr1", label: "דירה ברחוב הגפן", status: "active", startDate: null, endDate: null, monthlyRentAmount: 3500, depositType: "cash", depositAmount: 7000 },
          { id: "l2", propertyId: "pr2", label: "מחסן", status: "ended", startDate: "2025-01-01", endDate: "2025-12-31", monthlyRentAmount: 900, depositType: null, depositAmount: null },
        ],
      })
    );
    const box = section("נכסים בשכירות");
    expect(box.textContent).not.toContain("החל מ--");
    expect(box).toHaveTextContent("החל מ-01/01/25");
    expect(box).toHaveTextContent("פיקדון כספי ₪7,000");
    expect(box).toHaveTextContent("₪3,500 לחודש");
  });

  it("the ⋮'s תיעוד שיחה opens the call form in the גבייה section", async () => {
    renderPage();
    expect(screen.queryByPlaceholderText("מה סוכם? מה הלקוח אמר?")).toBeNull();
    fireEvent.click(within(await openPhoneMenu()).getByText("תיעוד שיחה"));
    expect(await screen.findByPlaceholderText("מה סוכם? מה הלקוח אמר?")).toBeInTheDocument();
    await waitFor(() => expect(toggle("גבייה ושיחות")).toHaveAttribute("aria-expanded", "true"));
  });

  it("the ⋮'s + משימה opens the task dialog, and the new task shows at once", async () => {
    renderPage();
    fireEvent.click(within(await openPhoneMenu()).getByText("משימה"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "משימה חדשה" })).getByRole("button", { name: "שמירת משימה" }));
    const box = section("משימות");
    expect(await within(box).findByText("לחזור ללקוח")).toBeInTheDocument();
    expect(within(box).getByText("אחראי: דנה")).toBeInTheDocument();
  });

  it("notes saved in the edit dialog replace the הערות section's text", async () => {
    renderPage(makeTop({ customer: { notes: "ישן" } }));
    expect(within(section("הערות")).getByText("ישן")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עריכת לקוח" }));
    expect(screen.getByText("הערות בטופס: ישן")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירת לקוח" }));
    expect(await within(section("הערות")).findByText("לתאם לפני משלוח")).toBeInTheDocument();
  });

  it("the הערות section's + starts writing a note", async () => {
    renderPage();
    expect(toggle("הערות")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "הוספת הערה" }));
    expect(await screen.findByRole("textbox", { name: "הערות ללקוח" })).toBeInTheDocument();
    await waitFor(() => expect(toggle("הערות")).toHaveAttribute("aria-expanded", "true"));
  });

  it("the Morning header follows the card: linked once the card links it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ morningClient: { id: "mc-1" } }), { status: 200 }));
    renderPage();
    const box = section("Morning");
    expect(within(box).getAllByText("לא מקושר")).toHaveLength(1);
    fireEvent.click(within(box).getByRole("button", { name: "יצירת לקוח ב-Morning" }));
    expect(await within(box).findByText("מקושר")).toBeInTheDocument();
  });

  it("office staff don't see the history", () => {
    renderPage(makeTop(), { role: "office" });
    expect(screen.queryByText("היסטוריית פעילות")).toBeNull();
    expect(screen.getByText("גבייה ושיחות")).toBeInTheDocument();
  });
});
