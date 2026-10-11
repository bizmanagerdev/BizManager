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
