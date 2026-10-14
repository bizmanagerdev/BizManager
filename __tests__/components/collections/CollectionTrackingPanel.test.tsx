// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The גבייה panel (the customer page's section, and the dialog it opens from a
// list). What changed with the customer page's playbook (2026-10-13):
// - it starts from what the page already read, and doesn't fetch it — the
//   receivables above all — a second time;
// - while it IS fetching it says so, not "אין תזכורות פתוחות";
// - a call or a reminder saved with no connection is on the panel at once,
//   marked as waiting;
// - after a call or a reminder it re-reads the log only, not the debt.

const h = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (..._args: unknown[]) => ({ queued: false as const, ok: true as const, data: {} as unknown })),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: h.offlineFetch, CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("@/hooks/useAssignableUsers", () => ({ useAssignableUsers: () => ({ users: [], currentUserId: "u1", loading: false }) }));
vi.mock("@/components/collections/AssigneeSelect", () => ({ AssigneeSelect: () => null }));
vi.mock("@/components/collections/CommunicationLogItem", () => ({
  default: ({ log }: { log: { content: string | null } }) => <div>{log.content}</div>,
}));

import CollectionTrackingPanel, { type CollectionPanelData } from "@/components/collections/CollectionTrackingPanel";
import type { CommunicationLog, Reminder } from "@/lib/communications";

function log(id: string, content: string): CommunicationLog {
  return {
    id,
    customer_id: "c1",
    user_id: null,
    channel: "phone",
    direction: "outgoing",
    content,
    category: "general",
    order_id: null,
    project_id: null,
    property_id: null,
    payment_id: null,
    created_by: null,
    created_at: "2026-10-10T08:00:00Z",
    created_by_name: null,
  };
}

function reminder(id: string, content: string, remindAt = "2026-10-20T08:00:00Z"): Reminder {
  return {
    id,
    customer_id: "c1",
    project_id: null,
    assigned_to: null,
    remind_at: remindAt,
    content,
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
    assigned_to_name: null,
    customer_name: null,
    customer_phone: null,
    task_subject: null,
  };
}

const DATA: CollectionPanelData = {
  logs: [log("l1", "דיברנו על התשלום")],
  reminders: [reminder("r1", "לחזור אליו")],
  receivables: [
    {
      source_type: "order",
      source_id: "o1abcdef99",
      collection_key: "order:o1",
      title: "הזמנה ספטמבר",
      business_domain: null,
      reference_date: "2026-09-01",
      total_amount: 1000,
      collected_amount: 400,
      outstanding_amount: 600,
      pending_amount: 200,
      overdue_amount: 0,
      next_due_date: null,
      due_date: "2026-10-01",
      payment_terms: "net_30",
      days_late: 12,
      collection_status: "overdue",
      pending_payments: [
        { id: "pay1", amount: 200, due_date: "2026-10-15", payment_method: "check", check_number: "77", overdue: false },
      ],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.offlineFetch.mockReset().mockResolvedValue({ queued: false, ok: true, data: {} });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ logs: [], reminders: [], receivables: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("CollectionTrackingPanel", () => {
  it("starts from the page's data and doesn't fetch it again", () => {
    render(<CollectionTrackingPanel customerId="c1" customerName="אלון" initialData={DATA} collapsibleForms today="2026-10-13" />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("דיברנו על התשלום")).toBeInTheDocument();
    expect(screen.getByText("לחזור אליו")).toBeInTheDocument();
    expect(screen.getByText("תזכורות פתוחות (1)")).toBeInTheDocument();
    // What's owed, in the app's money format.
    expect(screen.getAllByText("₪600")).toHaveLength(2);
    expect(screen.getByText(/₪200 · פירעון 15\/10\/26/)).toBeInTheDocument();
  });

  it("while fetching says it's loading — not 'אין תזכורות פתוחות'", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    render(<CollectionTrackingPanel customerId="c1" customerName="אלון" />);
    expect(fetchMock).toHaveBeenCalledWith("/api/collections/activity?customer_id=c1");
    expect(screen.queryByText("אין תזכורות פתוחות.")).toBeNull();
    expect(screen.getAllByText("טוען...")).toHaveLength(2);
    await act(async () => answer(new Response(JSON.stringify({ logs: [], reminders: [], receivables: [] }), { status: 200 })));
    expect(await screen.findByText("אין תזכורות פתוחות.")).toBeInTheDocument();
    expect(screen.getByText("עדיין לא תועדו שיחות.")).toBeInTheDocument();
  });

  it("a call logged with no connection is on the panel at once, marked as waiting, with its follow-up", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    const onChanged = vi.fn();
    render(<CollectionTrackingPanel customerId="c1" customerName="אלון" initialData={DATA} collapsibleForms onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "תיעוד שיחה" }));
    fireEvent.change(screen.getByRole("textbox", { name: "תוכן השיחה" }), { target: { value: "הבטיח לשלם ביום ראשון" } });
    fireEvent.click(screen.getByRole("checkbox"));
    const [dateInput] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(dateInput!, { target: { value: "2026-10-18T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));

    expect(await screen.findAllByText("ממתין לשליחה")).toHaveLength(2);
    const waiting = screen.getByText("הבטיח לשלם ביום ראשון", { selector: "div" });
    expect(within(waiting.closest("div.rounded-xl") as HTMLElement).getByText("ממתין לשליחה")).toBeInTheDocument();
    // The form folded away again.
    expect(screen.queryByRole("textbox", { name: "תוכן השיחה" })).toBeNull();
    expect(screen.getByText("תזכורות פתוחות (2)")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith("activity");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a reminder set with no connection is on the panel at once, marked as waiting", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    render(<CollectionTrackingPanel customerId="c1" customerName="אלון" initialData={DATA} collapsibleForms />);
    fireEvent.click(screen.getByRole("button", { name: "תזכורת" }));
    const [dateInput] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(dateInput!, { target: { value: "2026-10-19T10:00" } });
    fireEvent.change(screen.getByPlaceholderText("על מה להזכיר? (אופציונלי)"), { target: { value: "לבדוק העברה" } });
    fireEvent.click(screen.getByRole("button", { name: "הוספת תזכורת" }));
    await screen.findByText("ממתין לשליחה");
    const waiting = screen.getByText("לבדוק העברה", { selector: "div" });
    expect(waiting.closest("div.rounded-xl")).toHaveTextContent("ממתין לשליחה");
    expect(waiting.closest("div.rounded-xl")).toHaveTextContent("19/10/26");
  });

  it("once the waiting saves go out, reads the real rows instead", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    render(<CollectionTrackingPanel customerId="c1" customerName="אלון" initialData={DATA} collapsibleForms />);
    fireEvent.click(screen.getByRole("button", { name: "תיעוד שיחה" }));
    fireEvent.change(screen.getByRole("textbox", { name: "תוכן השיחה" }), { target: { value: "שיחה בלי קליטה" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText("ממתין לשליחה");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ logs: [log("l2", "שיחה בלי קליטה")], reminders: [] }), { status: 200 })
    );
    await act(async () => {
      window.dispatchEvent(new Event("biz:conn-synced"));
    });
    await waitFor(() => expect(screen.queryByText("ממתין לשליחה")).toBeNull());
    expect(screen.getByText("שיחה בלי קליטה")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/collections/activity?customer_id=c1&receivables=0");
  });

  it("after a call it re-reads the log only — the debt is left as it was", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: true, data: { id: "l9" } });
    render(<CollectionTrackingPanel customerId="c1" customerName="אלון" initialData={DATA} collapsibleForms />);
    fireEvent.click(screen.getByRole("button", { name: "תיעוד שיחה" }));
    fireEvent.change(screen.getByRole("textbox", { name: "תוכן השיחה" }), { target: { value: "שיחה" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/collections/activity?customer_id=c1&receivables=0"));
    // The debt stays on screen (the answer had no receivables to replace it with).
    expect(screen.getAllByText("₪600")).toHaveLength(2);
  });

  it("opens the form the page asks for", async () => {
    const { rerender } = render(
      <CollectionTrackingPanel customerId="c1" customerName="אלון" initialData={DATA} collapsibleForms formRequest={null} />
    );
    expect(screen.queryByText("קביעת תזכורת")).toBeNull();
    rerender(
      <CollectionTrackingPanel
        customerId="c1"
        customerName="אלון"
        initialData={DATA}
        collapsibleForms
        formRequest={{ form: "reminder", key: 1 }}
      />
    );
    expect(await screen.findByText("קביעת תזכורת")).toBeInTheDocument();
    // Closing is the quiet grey button.
    expect(screen.getByRole("button", { name: "סגירה" }).className).toContain("bg-foreground/[0.06]");
  });

  it("reports the open reminders' count, and takes a newer reading from the page", async () => {
    const onCount = vi.fn();
    const { rerender } = render(
      <CollectionTrackingPanel customerId="c1" customerName="אלון" initialData={DATA} collapsibleForms onOpenRemindersChange={onCount} />
    );
    expect(onCount).toHaveBeenLastCalledWith(1);
    rerender(
      <CollectionTrackingPanel
        customerId="c1"
        customerName="אלון"
        initialData={{ ...DATA, reminders: [] }}
        collapsibleForms
        onOpenRemindersChange={onCount}
      />
    );
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(0));
    expect(screen.getByText("אין תזכורות פתוחות.")).toBeInTheDocument();
  });

  it("marks an overdue reminder by the server's day on the first paint", () => {
    render(
      <CollectionTrackingPanel
        customerId="c1"
        customerName="אלון"
        initialData={{ ...DATA, reminders: [reminder("r2", "באיחור כבר", "2026-10-01T08:00:00Z")] }}
        collapsibleForms
        today="2026-10-13"
      />
    );
    expect(screen.getByText("(באיחור)")).toBeInTheDocument();
  });

  it("in a dialog, the customer's phone is the app's contact link", () => {
    render(<CollectionTrackingPanel customerId="c1" customerName="אלון" customerPhone="050-1234567" initialData={DATA} />);
    expect(screen.getByText("050-1234567").closest("a")).toHaveAttribute("href", "tel:0501234567");
  });
});
