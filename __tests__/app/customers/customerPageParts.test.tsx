// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The customer page's smaller parts: the tags on the לקוח card, the tasks,
// the money card's מאזן מול העסק, the loading screen, the delete dialog's
// other turns, and the arrival details' dialog (shared with the deliveries
// queue) — which now waits in the send queue instead of failing offline.

const h = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (..._args: unknown[]) => ({ queued: false as const, ok: true as const, data: {} as unknown })),
  scheduleDeferredDelete: vi.fn(),
  registerReversibleAction: vi.fn(),
  title: { current: null as null | { title: unknown; subtitle: unknown; action: unknown } },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: h.offlineFetch, CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("@/lib/undo-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/undo-engine")>()),
  scheduleDeferredDelete: h.scheduleDeferredDelete,
  registerReversibleAction: h.registerReversibleAction,
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("@/components/layout/page-title-context", () => ({
  useSetPageTitle: (title: unknown, subtitle: unknown, action: unknown) => {
    h.title.current = { title, subtitle, action };
  },
}));
vi.mock("@/components/tasks/TaskUpsertDialog", () => ({
  TaskUpsertDialog: (props: { open: boolean; mode: string; onSaved?: (row?: Record<string, unknown> | null) => void }) =>
    props.open ? (
      <div role="dialog" aria-label={props.mode === "create" ? "משימה חדשה" : "עריכת משימה"}>
        <button type="button" onClick={() => props.onSaved?.(null)}>
          שמירה בלי שורה
        </button>
      </div>
    ) : null,
}));
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

import { push, refresh } from "@/__tests__/mocks/next-navigation";
import CustomerTagsSection from "@/app/(app)/customers/[id]/CustomerTagsSection";
import CustomerTasksSection from "@/app/(app)/customers/[id]/CustomerTasksSection";
import CustomerMoneyCard, { activityText } from "@/app/(app)/customers/[id]/CustomerMoneyCard";
import CustomerPageSkeleton from "@/app/(app)/customers/[id]/CustomerPageSkeleton";
import DeleteCustomerButton from "@/app/(app)/customers/[id]/DeleteCustomerButton";
import { DeliveryLocationDialog } from "@/components/orders/DeliveryLocationDialog";
import MissingDocumentsChecklist from "@/components/documents/MissingDocumentsChecklist";
import { leaseStartText } from "@/app/(app)/customers/[id]/CustomerLeasesSection";
import { settled, NO_PAYMENTS } from "@/__tests__/app/customers/customerPageFixtures";
import { summarizeCustomerMoney } from "@/app/(app)/customers/[id]/customerPageModel";

vi.mock("@/components/collections/CollectionTrackingPanel", () => ({
  default: (props: {
    formRequest: { form: string; key: number } | null;
    onChanged: (what: "money" | "activity") => void;
    onOpenRemindersChange: (count: number) => void;
  }) => (
    <div>
      <span>טופס: {props.formRequest?.form ?? "אין"}</span>
      <button type="button" onClick={() => props.onChanged("activity")}>
        שיחה נשמרה
      </button>
      <button type="button" onClick={() => props.onChanged("money")}>
        תשלום נגבה
      </button>
      <button type="button" onClick={() => props.onOpenRemindersChange(3)}>
        שלוש תזכורות
      </button>
    </div>
  ),
}));
vi.mock("@/components/collections/PaymentPromises", () => ({
  default: (props: { formOpen: boolean; onPendingCountChange: (count: number) => void }) => (
    <div>
      <span>טופס הבטחה: {String(props.formOpen)}</span>
      <button type="button" onClick={() => props.onPendingCountChange(4)}>
        ארבע ממתינות
      </button>
    </div>
  ),
}));

import CustomerCollectionSection from "@/app/(app)/customers/[id]/CustomerCollectionSection";
import CustomerPromisesSection from "@/app/(app)/customers/[id]/CustomerPromisesSection";
import CustomerDeliveryDetails from "@/app/(app)/customers/[id]/CustomerDeliveryDetails";
import AddContactButton from "@/app/(app)/customers/[id]/AddContactButton";

vi.mock("@/lib/documents/checklist", () => ({
  fetchChecklistForEntity: vi.fn(async () => [
    { code: "insurance", label: "ביטוח", present: true, documentId: "d1", validUntil: "2027-03-31" },
  ]),
}));

beforeEach(() => {
  h.offlineFetch.mockReset().mockResolvedValue({ queued: false, ok: true, data: {} });
  h.scheduleDeferredDelete.mockReset();
  h.registerReversibleAction.mockReset();
  refresh.mockClear();
  push.mockClear();
});

describe("the tags", () => {
  it("a removed tag goes at once and the page isn't read again; its ✕ is a finger's size", async () => {
    render(<CustomerTagsSection customerId="c-tags" tags={[{ id: "t1", name: "VIP" }, { id: "t2", name: "סיטונאי" }]} />);
    const remove = screen.getByRole("button", { name: "הסרת תגית VIP" });
    expect(remove.className).toContain("before:-inset-3.5");
    fireEvent.click(remove);
    const removal = h.scheduleDeferredDelete.mock.calls[0]![0] as { onCommit: () => Promise<{ ok: boolean }> };
    await expect(removal.onCommit()).resolves.toEqual({ ok: true });
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/customers/update", { id: "c-tags", tag_ids: ["t1", "t2"] }, "הסרת תגית");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no tags, nothing drawn", () => {
    const { container } = render(<CustomerTagsSection customerId="c1" tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the tasks", () => {
  const base = {
    customerId: "c1",
    customerName: "אלון",
    customerPhone: "050-1234567",
    users: [{ id: "u1", label: "דנה", color: null }],
    currentUserId: "u1",
    today: "2026-10-13",
  };

  it("says a task is late by the day the page was drawn on", () => {
    render(
      <CustomerTasksSection
        {...base}
        tasks={[
          { id: "t1", subject: "להתקשר", status: "todo", priority: "high", due_date: "2026-10-01", assigned_user_name: "דנה", has_open_reminder: true, is_private: true },
          { id: "t2", subject: "סגור", status: "done", priority: null, due_date: "2026-10-01", assigned_user_name: null, has_open_reminder: false, is_private: false },
        ]}
        createOpen={false}
        onCreateOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText(/באיחור ·/)).toHaveTextContent("באיחור · 01/10/26");
    expect(screen.getAllByText(/01\/10\/26/)).toHaveLength(2);
    expect(screen.getByLabelText("פרטית")).toBeInTheDocument();
    expect(screen.getByLabelText("יש תזכורת פתוחה")).toBeInTheDocument();
  });

  it("a task saved with nothing handed back (it waits for the connection) has the page read again", async () => {
    render(<CustomerTasksSection {...base} tasks={[]} createOpen onCreateOpenChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "שמירה בלי שורה" }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("אין משימות ללקוח זה.")).toBeInTheDocument();
  });

  it("an edit has the page read its tasks again", async () => {
    render(
      <CustomerTasksSection
        {...base}
        tasks={[{ id: "t1", subject: "להתקשר", status: "todo", priority: null, due_date: null, assigned_user_name: null, has_open_reminder: false, is_private: false }]}
        createOpen={false}
        onCreateOpenChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /להתקשר/ }));
    fireEvent.click(await screen.findByRole("button", { name: "שמירה בלי שורה" }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("the money card", () => {
  it("folds מאזן מול העסק in: the loans both ways, the net, and the salary beside it", () => {
    render(
      <CustomerMoneyCard
        money={summarizeCustomerMoney({ orders: [], projects: [], receivables: [] })}
        balance={{ salesOwedToUs: 0, rentOwedToUs: 0, loansOwedToUs: 2000, loansOwedByUs: 500, totalOwedToUs: 2000, totalOwedByUs: 500, net: 1500, payrollOwed: 800 }}
        payments={settled(NO_PAYMENTS)}
        today="2026-10-13"
        onCollectionActions={null}
      />
    );
    expect(screen.getByText("מאזן מול העסק")).toBeInTheDocument();
    expect(screen.getByText("הלוואה שנתתי לו").nextElementSibling).toHaveTextContent("₪2,000");
    expect(screen.getByText("הלוואה שלקחתי ממנו").nextElementSibling).toHaveTextContent("₪500");
    expect(screen.getByText("נטו — חייב לנו").nextElementSibling).toHaveTextContent("₪1,500");
    expect(screen.getByText("שכר פתוח (מחוץ לנטו)").nextElementSibling).toHaveTextContent("₪800");
    // No collection actions for a viewer who can't take them.
    expect(screen.queryByRole("button", { name: "פעולות גבייה" })).toBeNull();
  });

  it("says how long ago only while it's days, the Hebrew way", () => {
    expect(activityText("2026-10-13", "2026-10-13")).toBe("13/10/26 (היום)");
    expect(activityText("2026-10-12T22:00:00", "2026-10-13")).toBe("12/10/26 (אתמול)");
    expect(activityText("2026-10-11", "2026-10-13")).toBe("11/10/26 (לפני יומיים)");
    expect(activityText("2026-10-08", "2026-10-13")).toBe("08/10/26 (לפני 5 ימים)");
    expect(activityText("2026-09-01", "2026-10-13")).toBe("01/09/26");
    expect(activityText(null, "2026-10-13")).toBe("—");
  });
});

describe("the leases", () => {
  it("says when a lease started only when it has a start date", () => {
    expect(leaseStartText(null)).toBeNull();
    expect(leaseStartText("2025-01-01")).toBe("החל מ-01/01/25");
  });
});

describe("the loading screen", () => {
  it("names the page in the top bar beside the ⋮'s place, and draws the cards and every section's header", () => {
    render(<CustomerPageSkeleton routeLoading />);
    expect(h.title.current?.title).toBe("לקוח");
    expect(h.title.current?.action).toBeTruthy();
    for (const label of ["לקוח", "חוב פתוח"]) expect(screen.getByText(label, { selector: "div" })).toBeInTheDocument();
    for (const title of ["הזמנות", "פרויקטים", "גבייה ושיחות", "משימות", "תשלומים אחרונים", "הבטחות תשלום", "אנשי קשר וסניפים", "מסמכים", "הערות", "Morning"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(document.querySelector('[data-route-loading="true"]')).not.toBeNull();
  });
});

describe("the delete dialog's other turns", () => {
  it("a customer already inactive is told so, with nothing to do", () => {
    const onOpenChange = vi.fn();
    render(
      <DeleteCustomerButton
        customerId="c1"
        customerName="אלון"
        blocker="יש ללקוח הזמנה אחת"
        active={false}
        open
        onOpenChange={onOpenChange}
        onActiveChange={vi.fn()}
      />
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("יש ללקוח הזמנה אחת. הלקוח כבר מסומן כלא פעיל.");
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.offlineFetch).not.toHaveBeenCalled();
  });

  it("a refused 'mark inactive' says why and stays open; a done one can be undone", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: false, status: 403, error: "אין הרשאה" } as never);
    const onActiveChange = vi.fn();
    render(
      <DeleteCustomerButton customerId="c1" customerName="אלון" blocker="יש ללקוח הזמנה אחת" active open onOpenChange={vi.fn()} onActiveChange={onActiveChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "סימון כלא פעיל" }));
    expect(await screen.findByText("אין הרשאה")).toBeInTheDocument();
    expect(onActiveChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "סימון כלא פעיל" }));
    await waitFor(() => expect(onActiveChange).toHaveBeenCalledWith(false));
    const undo = h.registerReversibleAction.mock.calls[0]![0] as { onUndo: () => Promise<{ ok: boolean }> };
    await act(async () => {
      await undo.onUndo();
    });
    expect(h.offlineFetch).toHaveBeenLastCalledWith("/api/customers/update", { id: "c1", active: true }, "סימון לקוח כפעיל");
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
  });

  it("with no connection, deletes by the page's own counts (the check can't be asked)", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<DeleteCustomerButton customerId="c1" customerName="אלון" blocker={null} active open onOpenChange={vi.fn()} onActiveChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
    expect(fetchSpy).not.toHaveBeenCalled();
    const deletion = h.scheduleDeferredDelete.mock.calls[0]![0] as { onCommit: () => Promise<{ ok: boolean }> };
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    await expect(deletion.onCommit()).resolves.toEqual({ ok: true });
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
  });
});

describe("the arrival details' dialog", () => {
  it("with no connection the save waits in the send queue and the page shows it at once", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DeliveryLocationDialog
        open
        onOpenChange={onOpenChange}
        customerId="c1"
        customerName="אלון"
        initialInstructions={null}
        initialPin={null}
        onSaved={onSaved}
      />
    );
    fireEvent.change(within(screen.getByRole("dialog")).getAllByRole("textbox")[0]!, { target: { value: "שער כחול מאחור" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ instructions: "שער כחול מאחור", pin: null }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.offlineFetch).toHaveBeenCalledWith(
      "/api/customers/delivery-location",
      { customer_id: "c1", instructions: "שער כחול מאחור", lat: null, lng: null },
      "פרטי הגעה ללקוח"
    );
  });

  it("its undo puts the previous details back, through the same queue", async () => {
    const onSaved = vi.fn();
    render(
      <DeliveryLocationDialog
        open
        onOpenChange={vi.fn()}
        customerId="c1"
        customerName="אלון"
        initialInstructions="ישן"
        initialPin={{ lat: 1, lng: 2 }}
        onSaved={onSaved}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(h.registerReversibleAction).toHaveBeenCalled());
    const undo = h.registerReversibleAction.mock.calls[0]![0] as { onUndo: () => Promise<{ ok: boolean }> };
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    await expect(undo.onUndo()).resolves.toEqual({ ok: true });
    expect(onSaved).toHaveBeenLastCalledWith({ instructions: "ישן", pin: { lat: 1, lng: 2 } });
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: false, status: 500, error: "x" } as never);
    expect((await undo.onUndo()).ok).toBe(false);
  });

  it("a refused save stays in the dialog with the reason", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: false, status: 403, error: "אין גישה" } as never);
    const onSaved = vi.fn();
    render(
      <DeliveryLocationDialog open onOpenChange={vi.fn()} customerId="c1" customerName="אלון" initialInstructions="א" initialPin={null} onSaved={onSaved} />
    );
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("אין גישה")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("the גבייה and promises sections", () => {
  it("the header's + asks for the call form; only a change in the debt reads the page again", () => {
    const onRequestForm = vi.fn();
    render(
      <CustomerCollectionSection
        customerId="c1"
        customerName="אלון"
        customerPhone={null}
        initialData={{ logs: [], reminders: [], receivables: [] }}
        hasDebt={false}
        formRequest={{ form: "reminder", key: 1 }}
        onRequestForm={onRequestForm}
        today="2026-10-13"
      />
    );
    expect(screen.getByText("טופס: reminder")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "תיעוד שיחה" }));
    expect(onRequestForm).toHaveBeenCalledWith("call");
    expect(window.location.hash).toBe("#collection-tracking");

    fireEvent.click(screen.getByRole("button", { name: "שיחה נשמרה" }));
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "תשלום נגבה" }));
    expect(refresh).toHaveBeenCalledTimes(1);

    // The header counts the open reminders as the panel reports them.
    fireEvent.click(screen.getByRole("button", { name: "שלוש תזכורות" }));
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("the promises' + opens the form; the count follows the list", () => {
    render(<CustomerPromisesSection customerId="c1" promises={[]} />);
    expect(screen.getByText("טופס הבטחה: false")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הבטחת תשלום חדשה" }));
    expect(screen.getByText("טופס הבטחה: true")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ארבע ממתינות" }));
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

describe("the arrival details on the לקוח card", () => {
  it("shows what was saved at once; 'ניווט' is a finger's size", async () => {
    render(<CustomerDeliveryDetails customerId="c1" customerName="אלון" instructions={null} pin={{ lat: 32.8, lng: 35.0 }} />);
    expect(screen.getByText("לא הוגדרו הוראות הגעה")).toBeInTheDocument();
    expect(screen.getByText("ניווט").closest("a")!.className).toContain("min-h-10");
    fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getAllByRole("textbox")[0]!, { target: { value: "קומה 2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("קומה 2", { selector: "p" })).toBeInTheDocument();
  });
});

describe("adding a contact", () => {
  it("asks for a name, and keeps the dialog open with the reason when it's refused", async () => {
    const onAdded = vi.fn();
    render(<AddContactButton customerId="c1" customerName="אלון" onAdded={onAdded} onUndone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "הוספת איש קשר" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "יצירת איש קשר" }));
    expect(await within(dialog).findByText("יש למלא שם איש קשר.")).toBeInTheDocument();
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: false, status: 400, error: "טלפון לא תקין" } as never);
    fireEvent.change(within(dialog).getAllByRole("textbox")[0]!, { target: { value: "משה" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "יצירת איש קשר" }));
    expect(await within(dialog).findByText("טלפון לא תקין")).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
  });
});

describe("the required documents", () => {
  it("states a document's expiry as a date", async () => {
    render(<MissingDocumentsChecklist entityType="customer" entityId="c1" />);
    expect(await screen.findByText("בתוקף עד 31/03/27")).toBeInTheDocument();
  });
});
