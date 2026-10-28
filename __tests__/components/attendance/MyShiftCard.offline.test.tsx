// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Clocking in with no signal (owner, 2026-10-11): it waits in the send queue
// with the time it was pressed, the card shows the shift open at once, and a
// shift already open on the phone's copy is caught first.

const { offlineFetch, readyLocalDatabase, localClient, toast } = vi.hoisted(() => ({
  offlineFetch: vi.fn(),
  readyLocalDatabase: vi.fn(),
  localClient: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch }));
vi.mock("@/lib/powersync/store", () => ({ readyLocalDatabase }));
vi.mock("@/lib/powersync/local-results", () => ({ localClient }));
// The clock-out's undo window, skipped: it commits at once.
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredAction: (args: { onApplyOptimistic: () => void; onCommit: () => Promise<unknown> }) => {
    args.onApplyOptimistic();
    void args.onCommit();
  },
}));

import MyShiftCard from "@/components/attendance/MyShiftCard";

let online = false;
beforeEach(() => {
  online = false;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  localStorage.clear();
  offlineFetch.mockReset();
  readyLocalDatabase.mockReset();
  localClient.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "onLine");
});

function openShiftReads(rows: unknown[]) {
  readyLocalDatabase.mockReturnValue({});
  const query = {
    select: () => query,
    eq: () => query,
    limit: async () => ({ data: rows, error: null }),
  };
  localClient.mockResolvedValue({ from: () => query });
}

describe("clocking in with no signal", () => {
  it("queues it with the time it was pressed and shows the shift open", async () => {
    openShiftReads([]);
    offlineFetch.mockResolvedValue({ queued: true, reason: "offline", key: "k" });
    render(<MyShiftCard openShift={null} pendingCount={0} locale="he" userId="worker-1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "פתיחת משמרת" }));
    });

    expect(offlineFetch).toHaveBeenCalledTimes(1);
    const [path, body] = offlineFetch.mock.calls[0];
    expect(path).toBe("/api/attendance/my/start");
    expect(typeof (body as { clock_in?: unknown }).clock_in).toBe("string");
    expect(screen.getByText(/משמרת פתוחה מ־/)).toBeTruthy();
    expect(localStorage.getItem("bizh-pending-shift")).toContain("clock_in");
  });

  it("refuses when the phone's copy already has a shift open", async () => {
    openShiftReads([{ id: "open-1" }]);
    render(<MyShiftCard openShift={null} pendingCount={0} locale="he" userId="worker-1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "פתיחת משמרת" }));
    });

    expect(offlineFetch).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("כבר יש לך משמרת פתוחה.");
  });

  it("shows a clock-in still waiting to be sent without re-rendering over and over", async () => {
    // Every reading of the clock moves it on, as on a busy phone: a card that
    // rebuilt the waiting shift each render restarted its minute ticker each
    // render, and never settled.
    let clock = Date.parse("2026-10-11T08:00:00Z");
    const now = vi.spyOn(Date, "now").mockImplementation(() => ++clock);
    localStorage.setItem(
      "bizh-pending-shift",
      JSON.stringify({ clock_in: "2026-10-11T07:00:00.000Z", notes: null, at: clock })
    );
    try {
      render(<MyShiftCard openShift={null} pendingCount={0} locale="he" userId="worker-1" />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(screen.getByText(/משמרת פתוחה מ־/)).toBeTruthy();
      expect(now.mock.calls.length).toBeLessThan(30);
    } finally {
      now.mockRestore();
    }
  });
});

// With the phone saying it's online, too (audit 2026-10-27): on a weak signal
// the press used to fail with nothing kept. It goes through the send queue
// with a key and the time it was pressed, whatever the phone says.
describe("clocking in with the phone saying it's online", () => {
  async function pressClockIn() {
    online = true;
    render(<MyShiftCard openShift={null} pendingCount={0} locale="he" userId="worker-1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "פתיחת משמרת" }));
    });
    expect(offlineFetch).toHaveBeenCalledTimes(1);
    return offlineFetch.mock.calls[0] as [string, Record<string, unknown>, string, { idempotent?: boolean }];
  }

  it("goes through the send queue with a key and the time it was pressed", async () => {
    offlineFetch.mockResolvedValue({ queued: false, ok: true, data: { ok: true, id: "r1" } });
    const [path, body, label, options] = await pressClockIn();
    expect(path).toBe("/api/attendance/my/start");
    expect(typeof body.clock_in).toBe("string");
    expect(label).toBe("פתיחת המשמרת");
    expect(options).toEqual({ idempotent: true });
    expect(readyLocalDatabase).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("המשמרת נפתחה.");
    // The server has it: nothing waits on the phone.
    expect(localStorage.getItem("bizh-pending-shift")).toBeNull();
  });

  it("on a weak signal it waits on the phone, and the card shows the shift open", async () => {
    offlineFetch.mockResolvedValue({ queued: true, reason: "slow", key: "k" });
    await pressClockIn();
    expect(screen.getByText(/משמרת פתוחה מ־/)).toBeTruthy();
    expect(localStorage.getItem("bizh-pending-shift")).toContain("clock_in");
  });

  it("refused by the server: says why, and nothing waits", async () => {
    offlineFetch.mockResolvedValue({ queued: false, ok: false, status: 409, error: "כבר יש לך משמרת פתוחה." });
    await pressClockIn();
    expect(toast.error).toHaveBeenCalledWith("כבר יש לך משמרת פתוחה.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(localStorage.getItem("bizh-pending-shift")).toBeNull();
  });
});

// A close resent after its answer was lost must be recognised by the server
// as done, never close a shift opened since (סאלח, 24–25/10): it names its shift.
describe("clocking out", () => {
  async function closeShiftOf(openShift: Parameters<typeof MyShiftCard>[0]["openShift"]) {
    online = true;
    offlineFetch.mockResolvedValue({ queued: false, ok: true, data: { ok: true } });
    render(<MyShiftCard openShift={openShift} pendingCount={0} locale="he" userId="worker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "סיום משמרת" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "שליחה לאישור" }));
    });
    expect(offlineFetch).toHaveBeenCalledTimes(1);
    const [path, body, , options] = offlineFetch.mock.calls[0];
    expect(path).toBe("/api/attendance/my/close");
    // Kept on the phone while it's on its way (an app closed mid-send sends it on the next start).
    expect(options).toEqual({ idempotent: true });
    return body as Record<string, unknown>;
  }

  it("names the shift it closes, with the time it was pressed", async () => {
    const body = await closeShiftOf({
      id: "report-7",
      clock_in: "2026-10-25T08:36:29.340Z",
      clock_out: null,
      worked_minutes: null,
      status: "open",
      source: "app",
      notes: null,
      created_at: "2026-10-25T08:36:29.399Z",
    });
    expect(body.report_id).toBe("report-7");
    expect(typeof body.clock_out).toBe("string");
  });

  it("names none for a clock-in still waiting to be sent (it has no id yet)", async () => {
    localStorage.setItem(
      "bizh-pending-shift",
      JSON.stringify({ clock_in: "2026-10-25T08:00:00.000Z", notes: null, at: Date.now() })
    );
    const body = await closeShiftOf(null);
    expect(body).not.toHaveProperty("report_id");
  });
});
