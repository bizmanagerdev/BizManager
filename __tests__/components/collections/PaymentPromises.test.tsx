// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

// הבטחות תשלום on the customer page. Both saves go through the send queue now:
// a promise marked kept with no connection stays kept — it was a direct
// browser write that failed offline, and the undo engine then put the old
// status back (2026-10-13) — and a new one shows at once, marked as waiting.
// Neither reads the whole page again.

const h = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (..._args: unknown[]) => ({ queued: false as const, ok: true as const, data: {} as unknown })),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: h.offlineFetch, CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

import { refresh } from "@/__tests__/mocks/next-navigation";
import PaymentPromises from "@/components/collections/PaymentPromises";
import type { PaymentPromise } from "@/lib/promises";

function promise(id: string, overrides: Partial<PaymentPromise> = {}): PaymentPromise {
  return {
    id,
    customer_id: "c1",
    order_id: null,
    project_id: null,
    amount: 1500,
    promised_date: "2026-10-20",
    status: "pending",
    notes: null,
    created_at: "2026-10-01T08:00:00Z",
    ...overrides,
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function fillForm(amount: string, isoDate: string) {
  fireEvent.change(screen.getByPlaceholderText("סכום"), { target: { value: amount } });
  const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]')!;
  fireEvent.change(dateInput, { target: { value: isoDate } });
}

beforeEach(() => {
  h.offlineFetch.mockReset().mockResolvedValue({ queued: false, ok: true, data: {} });
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PaymentPromises", () => {
  it("marking a promise kept with no connection keeps it kept", async () => {
    h.offlineFetch.mockResolvedValue({ queued: true, reason: "offline" } as never);
    render(<PaymentPromises customerId="c1" promises={[promise("pp-kept-offline")]} />);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const row = screen.getByText("₪1,500").closest("li") as HTMLElement;
    expect(within(row).getByText("ממתינה")).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "קוימה" }));
    expect(within(row).getByText("קוימה")).toBeInTheDocument();

    // The undo window passes; the change goes to the send queue and waits there.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await flush();
    });
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/payment-promises/update", { id: "pp-kept-offline", status: "kept" }, "עדכון הבטחת תשלום");
    expect(within(row).getByText("קוימה")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "קוימה" })).toBeNull();
  });

  it("a refused change comes back, with the reason", async () => {
    h.offlineFetch.mockResolvedValue({ queued: false, ok: false, status: 404, error: "ההבטחה לא נמצאה" } as never);
    render(<PaymentPromises customerId="c1" promises={[promise("pp-refused")]} />);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const row = screen.getByText("₪1,500").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "הופרה" }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await flush();
    });
    expect(within(row).getByText("ממתינה")).toBeInTheDocument();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it("a new promise with no connection shows at once, marked as waiting", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: true, reason: "offline" } as never);
    render(<PaymentPromises customerId="c1" promises={[]} />);
    expect(screen.getByText("אין הבטחות תשלום ללקוח זה.")).toBeInTheDocument();
    fillForm("500", "2026-10-25");
    fireEvent.click(screen.getByRole("button", { name: "הוספת הבטחה" }));
    const row = (await screen.findByText("₪500")).closest("li") as HTMLElement;
    expect(row).toHaveTextContent("עד 25/10/26");
    expect(within(row).getByText("ממתין לשליחה")).toBeInTheDocument();
    // Nothing to mark on a row the server hasn't numbered yet.
    expect(within(row).queryByRole("button", { name: "קוימה" })).toBeNull();
    expect(h.offlineFetch).toHaveBeenCalledWith(
      "/api/payment-promises/create",
      // Its currency goes with it (2026-10-25): shekels unless the sign was changed.
      { customer_id: "c1", amount: 500, currency: "ILS", promised_date: "2026-10-25", notes: undefined },
      "הבטחת תשלום",
      { idempotent: true }
    );
  });

  it("a new promise shows at once with its undo — the page isn't read again", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: true, data: { ok: true, id: "pp-new" } });
    const onFormOpenChange = vi.fn();
    render(<PaymentPromises customerId="c1" promises={[promise("pp-old", { promised_date: "2026-09-01" })]} formOpen onFormOpenChange={onFormOpenChange} />);
    fillForm("700", "2026-11-02");
    fireEvent.click(screen.getByRole("button", { name: "הוספת הבטחה" }));
    expect(await screen.findByText("₪700")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    // Newest promised date first.
    expect(rows[0]).toHaveTextContent("₪700");
    expect(h.toast.success).toHaveBeenCalledWith("ההבטחה נוספה.", expect.anything());
    expect(onFormOpenChange).toHaveBeenCalledWith(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks for an amount and a date before saving", () => {
    render(<PaymentPromises customerId="c1" promises={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "הוספת הבטחה" }));
    expect(h.toast.error).toHaveBeenCalledWith("יש להזין סכום.");
    fireEvent.change(screen.getByPlaceholderText("סכום"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "הוספת הבטחה" }));
    expect(h.toast.error).toHaveBeenCalledWith("יש לבחור תאריך הבטחה.");
    expect(h.offlineFetch).not.toHaveBeenCalled();
  });

  it("states each promise in the app's formats: ₪ first, dd/mm/yy, a grey 'בוטלה'", () => {
    const onCount = vi.fn();
    render(
      <PaymentPromises
        customerId="c1"
        promises={[promise("a", { status: "cancelled", amount: 2500.5, notes: "בהעברה" }), promise("b")]}
        formOpen={false}
        onPendingCountChange={onCount}
      />
    );
    const cancelled = screen.getByText("₪2,500.5").closest("li") as HTMLElement;
    expect(cancelled).toHaveTextContent("עד 20/10/26");
    expect(cancelled).toHaveTextContent("בהעברה");
    expect(within(cancelled).getByText("בוטלה").className).toContain("bg-muted");
    expect(screen.queryByPlaceholderText("סכום")).toBeNull();
    expect(onCount).toHaveBeenLastCalledWith(1);
  });
});
