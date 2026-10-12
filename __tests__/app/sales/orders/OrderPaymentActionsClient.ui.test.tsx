// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// An order's payments, on its page — a short list inside the page, so its
// pencil and bin stay in view. After the owner's decisions of 2026-10-11 the
// bin asks first in the app's one confirm dialog (it opened an inline "אשר
// מחיקה / ביטול" pair beside itself), and only a confirmed delete is sent.
// Mocked at the send queue only.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const send = vi.hoisted(() => ({
  fetch: vi.fn(async (_url: string, _body?: unknown, _label?: string) => ({ ok: true, queued: false, data: {} })),
}));
vi.mock("@/lib/offline-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-queue")>()),
  offlineFetch: send.fetch,
}));

import { OrderPaymentActionsClient, type PaymentItem } from "@/app/(app)/sales/orders/OrderPaymentActionsClient";

function payment(over: Partial<PaymentItem> = {}): PaymentItem {
  return {
    id: "pay-1",
    payment_date: "2026-10-05",
    amount_total: 500,
    payment_method: "cash",
    payment_status: "cleared",
    due_date: null,
    reference_number: null,
    check_number: null,
    account_id: null,
    notes: null,
    insertedByLabel: null,
    morningDocuments: [],
    files: [],
    ...over,
  };
}

function renderList(payments: PaymentItem[] = [payment()]) {
  // No customer: the payment's Morning panel (its own tests) stays out of it.
  return render(
    <OrderPaymentActionsClient orderId="ord-1" customerId={null} totalAmount={1000} payments={payments} canManage />
  );
}

describe("an order's payments — deleting one", () => {
  beforeEach(() => {
    send.fetch.mockClear();
  });

  it("asks in the confirm dialog first, and sends nothing until it's answered", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "מחיקת תשלום" }));

    const ask = await screen.findByRole("dialog");
    expect(within(ask).getByRole("heading", { name: "מחיקת תשלום" })).toBeInTheDocument();
    expect(within(ask).getByText(/^למחוק את התשלום של .*500 מתאריך .*\? לא ניתן לשחזר\.$/)).toBeInTheDocument();
    // The answer is a noun; the old inline pair is gone.
    expect(within(ask).getByRole("button", { name: "מחיקה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אשר מחיקה" })).toBeNull();
    expect(send.fetch).not.toHaveBeenCalled();
  });

  it("deletes once confirmed: the row leaves at once and the server is told", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "מחיקת תשלום" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "מחיקה" }));

    await waitFor(() =>
      expect(send.fetch).toHaveBeenCalledWith(
        "/api/orders/payments/delete",
        { id: "pay-1", order_id: "ord-1" },
        "מחיקת תשלום"
      )
    );
    expect(send.fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The list's empty box, the app's one look.
    expect(screen.getByText("עדיין לא הוזנו תשלומים להזמנה זו.")).toBeInTheDocument();
  });

  it("keeps the payment, and sends nothing, when the question is cancelled", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "מחיקת תשלום" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "ביטול" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(send.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "מחיקת תשלום" })).toBeInTheDocument();
  });

  it("names a refund as a refund", async () => {
    renderList([payment({ id: "ref-1", amount_total: -50 })]);
    fireEvent.click(screen.getByRole("button", { name: "מחיקת תשלום" }));
    expect(within(await screen.findByRole("dialog")).getByText(/^למחוק את ההחזר של .*50 /)).toBeInTheDocument();
  });

  it("deletes the one asked about, not its neighbour", async () => {
    renderList([payment({ id: "pay-1" }), payment({ id: "pay-2", amount_total: 300 })]);
    fireEvent.click(screen.getAllByRole("button", { name: "מחיקת תשלום" })[1]);
    const ask = await screen.findByRole("dialog");
    expect(within(ask).getByText(/של .*300/)).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: "מחיקה" }));

    await waitFor(() =>
      expect(send.fetch).toHaveBeenCalledWith(
        "/api/orders/payments/delete",
        { id: "pay-2", order_id: "ord-1" },
        "מחיקת תשלום"
      )
    );
    await waitFor(() => expect(screen.getAllByRole("button", { name: "מחיקת תשלום" })).toHaveLength(1));
  });
});
