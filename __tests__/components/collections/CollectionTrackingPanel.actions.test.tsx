// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The גבייה panel's actions, each with its undo: a payment marked collected
// (the one change that moves the debt — the page re-reads its money card for
// it), a reminder done or cancelled, a call or a reminder saved online, and
// the form's own checks.

const h = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (..._args: unknown[]) => ({ queued: false as const, ok: true as const, data: {} as unknown })),
  scheduleDeferredAction: vi.fn(),
  scheduleDeferredDelete: vi.fn(),
  registerReversibleCreate: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: h.offlineFetch, CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredAction: h.scheduleDeferredAction,
  scheduleDeferredDelete: h.scheduleDeferredDelete,
  registerReversibleCreate: h.registerReversibleCreate,
}));
vi.mock("@/hooks/useUndoOverlay", () => ({ useUndoOverlay: <T,>(items: T[]) => items }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("@/hooks/useAssignableUsers", () => ({ useAssignableUsers: () => ({ users: [], currentUserId: "u1", loading: false }) }));
vi.mock("@/components/collections/AssigneeSelect", () => ({ AssigneeSelect: () => null }));
vi.mock("@/components/collections/EditReminderDialog", () => ({
  default: ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) => (
    <div role="dialog" aria-label="עריכת תזכורת">
      <button
        type="button"
        onClick={() => {
          onSaved();
          onClose();
        }}
      >
        שמירת תזכורת
      </button>
    </div>
  ),
}));
vi.mock("@/components/collections/CommunicationLogItem", () => ({
  default: ({ log, onChanged }: { log: { content: string | null }; onChanged: () => void }) => (
    <button type="button" onClick={onChanged}>
      {log.content}
    </button>
  ),
}));

import CollectionTrackingPanel, { type CollectionPanelData } from "@/components/collections/CollectionTrackingPanel";

type Deferred = { onApplyOptimistic: () => void; onRevert: () => void; onCommit: () => Promise<{ ok: boolean; error?: string }> };
type Reversible = { scope: string; id: string; onUndo: () => Promise<{ ok: boolean }> };

const DATA: CollectionPanelData = {
  logs: [
    {
      id: "l1",
      customer_id: "c1",
      user_id: null,
      channel: "phone",
      direction: "outgoing",
      content: "שיחה קודמת",
      category: "general",
      order_id: null,
      project_id: null,
      property_id: null,
      payment_id: null,
      created_by: null,
      created_at: "2026-10-10T08:00:00Z",
      created_by_name: null,
    },
  ],
  reminders: [
    {
      id: "r1",
      customer_id: "c1",
      project_id: null,
      assigned_to: "u1",
      remind_at: "2026-10-20T08:00:00Z",
      content: null,
      action_type: "call",
      status: "pending",
      category: "collection",
      order_id: null,
      property_id: null,
      payment_id: null,
      communication_log_id: null,
      task_id: null,
      created_by: null,
      created_at: "2026-10-01T08:00:00Z",
      updated_at: "2026-10-01T08:00:00Z",
      assigned_to_name: "דנה",
      customer_name: null,
      customer_phone: null,
      task_subject: null,
    },
  ],
  receivables: [
    {
      source_type: "loan",
      source_id: "loan1",
      collection_key: "loan:loan1",
      title: "הלוואת גישור",
      business_domain: null,
      reference_date: null,
      total_amount: 5000,
      collected_amount: 0,
      outstanding_amount: 5000,
      pending_amount: 0,
      overdue_amount: 0,
      next_due_date: "2026-11-01",
      due_date: null,
      payment_terms: null,
      days_late: 0,
      collection_status: "unpaid",
      pending_payments: [],
    },
    {
      source_type: "project",
      source_id: "proj12345678",
      collection_key: "project:p1",
      title: null,
      business_domain: null,
      reference_date: "2026-09-01",
      total_amount: 3000,
      collected_amount: 1000,
      outstanding_amount: 2000,
      pending_amount: 2000,
      overdue_amount: 2000,
      next_due_date: null,
      due_date: null,
      payment_terms: null,
      days_late: 3,
      collection_status: "overdue",
      pending_payments: [{ id: "pay9", amount: 2000, due_date: "2026-10-10", payment_method: "check", check_number: "5", overdue: true }],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

function renderPanel(onChanged = vi.fn()) {
  render(<CollectionTrackingPanel customerId="c1" customerName="אלון" initialData={DATA} collapsibleForms onChanged={onChanged} />);
  return onChanged;
}

beforeEach(() => {
  // The day these fixtures are drawn for: the reminder of 20/10 not yet late,
  // the check due 10/10 already late — whatever day the tests run on.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T09:00:00Z"));
  h.offlineFetch.mockReset().mockResolvedValue({ queued: false, ok: true, data: {} });
  h.scheduleDeferredAction.mockReset();
  h.scheduleDeferredDelete.mockReset();
  h.registerReversibleCreate.mockReset();
  h.toast.success.mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ logs: DATA.logs, reminders: DATA.reminders, receivables: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CollectionTrackingPanel's actions", () => {
  it("names a loan and a project by what they are, with the loan's way to record a repayment", () => {
    renderPanel();
    expect(screen.getByText("הלוואה — הלוואת גישור")).toBeInTheDocument();
    expect(screen.getByText("פרויקט #proj1234")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "רישום החזר" })).toHaveAttribute("href", "/financial/loans/loan1");
    expect(screen.getByText(/\(באיחור\)/)).toBeInTheDocument();
  });

  it("a payment marked collected leaves the list at once; the debt is read again and the page told it changed", async () => {
    const onChanged = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "סמן כנגבה" }));
    const action = h.scheduleDeferredAction.mock.calls[0]![0] as Deferred;
    act(() => action.onApplyOptimistic());
    expect(screen.queryByRole("button", { name: "סמן כנגבה" })).toBeNull();
    await act(async () => {
      await action.onCommit();
    });
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/payments/mark-collected", { id: "pay9", collected: true }, "סימון תשלום כנגבה");
    expect(fetchMock).toHaveBeenCalledWith("/api/collections/activity?customer_id=c1");
    expect(onChanged).toHaveBeenCalledWith("money");

    act(() => action.onRevert());
  });

  it("a refused 'collected' comes back with a Hebrew reason", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "סמן כנגבה" }));
    const action = h.scheduleDeferredAction.mock.calls[0]![0] as Deferred;
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: false, status: 400, error: "x" } as never);
    const result = await action.onCommit();
    expect(result.ok).toBe(false);
  });

  it("a reminder done or cancelled goes through the send queue, and the log is read again", async () => {
    const onChanged = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /בוצע/ }));
    fireEvent.click(screen.getByRole("button", { name: "ביטול תזכורת" }));
    const [done, cancelled] = h.scheduleDeferredDelete.mock.calls.map((call) => call[0] as Deferred & { message: string });
    expect(done!.message).toBe("התזכורת סומנה כבוצעה");
    expect(cancelled!.message).toBe("התזכורת בוטלה");
    await act(async () => {
      await done!.onCommit();
    });
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/reminders/update", { id: "r1", status: "done" }, "סימון תזכורת כבוצעה");
    expect(fetchMock).toHaveBeenCalledWith("/api/collections/activity?customer_id=c1&receivables=0");
    expect(onChanged).toHaveBeenCalledWith("activity");
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: false, status: 400, error: "x" } as never);
    expect((await cancelled!.onCommit()).ok).toBe(false);
  });

  it("a reminder set online is read back and can be undone", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: true, data: { id: "r-new" } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "תזכורת" }));
    fireEvent.click(screen.getByRole("button", { name: "הוספת תזכורת" }));
    expect(screen.getByText("יש לבחור תאריך ושעה לתזכורת.")).toBeInTheDocument();
    const [dateInput] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(dateInput!, { target: { value: "2026-10-19T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "הוספת תזכורת" }));
    await waitFor(() => expect(h.registerReversibleCreate).toHaveBeenCalled());
    const undo = h.registerReversibleCreate.mock.calls[0]![0] as Reversible;
    expect(undo).toMatchObject({ scope: "reminder", id: "r-new" });
    await act(async () => {
      await undo.onUndo();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/reminders/update", expect.objectContaining({ body: JSON.stringify({ id: "r-new", status: "cancelled" }) }));
  });

  it("a call logged online is read back; undoing it deletes it and cancels its follow-up", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: true, data: { id: "l-new", reminder_id: "r-follow" } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "תיעוד שיחה" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(screen.getByText("יש להזין תוכן שיחה או לקבוע תזכורת.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(screen.getByText("יש לבחור תאריך ושעה לתזכורת ההמשך.")).toBeInTheDocument();
    const [dateInput] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(dateInput!, { target: { value: "2026-10-19T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(h.registerReversibleCreate).toHaveBeenCalled());
    const undo = h.registerReversibleCreate.mock.calls[0]![0] as Reversible & { message: string };
    expect(undo.message).toBe("השיחה תועדה ותזכורת המשך נקבעה");
    await act(async () => {
      await undo.onUndo();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/communications/delete", expect.objectContaining({ body: JSON.stringify({ id: "l-new" }) }));
    expect(fetchMock).toHaveBeenCalledWith("/api/reminders/update", expect.objectContaining({ body: JSON.stringify({ id: "r-follow", status: "cancelled" }) }));
  });

  it("a refused call stays in the form with the reason", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: false, status: 400, error: "התוכן ארוך מדי" } as never);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "תיעוד שיחה" }));
    fireEvent.change(screen.getByRole("textbox", { name: "תוכן השיחה" }), { target: { value: "שיחה" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("התוכן ארוך מדי")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "תוכן השיחה" })).toBeInTheDocument();
  });

  it("an edited reminder or call log has the log read again", async () => {
    const onChanged = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "עריכת תזכורת" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירת תזכורת" }));
    fireEvent.click(screen.getByRole("button", { name: "שיחה קודמת" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalledWith("activity");
  });

  it("a fetch that fails says so", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "שגיאת שרת" }), { status: 500 }));
    render(<CollectionTrackingPanel customerId="c1" customerName="אלון" />);
    expect((await screen.findAllByText("שגיאת שרת")).length).toBeGreaterThan(0);
    fetchMock.mockRejectedValueOnce(new Error("network"));
  });
});
