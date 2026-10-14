// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The הערות section's editor. The notes the page hands in win whenever they
// change — edited in the customer's edit dialog, they used to stay old here
// (the text was read on the first render only, 2026-10-13). A save shows at
// once and goes out through the send queue, without reading the page again.

const h = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (..._args: unknown[]) => ({ queued: false as const, ok: true as const, data: {} })),
  scheduleDeferredAction: vi.fn(),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: h.offlineFetch }));
vi.mock("@/lib/undo-engine", () => ({ scheduleDeferredAction: h.scheduleDeferredAction }));
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

import { refresh } from "@/__tests__/mocks/next-navigation";
import CustomerNotesEditor from "@/app/(app)/customers/[id]/CustomerNotesEditor";

type Deferred = {
  onApplyOptimistic: () => void;
  onRevert: () => void;
  onCommit: () => Promise<{ ok: boolean; error?: string }>;
};

beforeEach(() => {
  h.offlineFetch.mockClear();
  h.scheduleDeferredAction.mockReset();
  refresh.mockClear();
});

describe("CustomerNotesEditor", () => {
  it("shows the page's new notes when they change (saved in the edit dialog)", () => {
    const { rerender } = render(<CustomerNotesEditor customerId="c1" initialNotes="ישן" />);
    expect(screen.getByText("ישן")).toBeInTheDocument();
    rerender(<CustomerNotesEditor customerId="c1" initialNotes="לתאם לפני משלוח" />);
    expect(screen.getByText("לתאם לפני משלוח")).toBeInTheDocument();
    expect(screen.queryByText("ישן")).toBeNull();
    // And the editor opens on them.
    fireEvent.click(screen.getByRole("button", { name: "עריכת הערות" }));
    expect(screen.getByRole("textbox", { name: "הערות ללקוח" })).toHaveValue("לתאם לפני משלוח");
  });

  it("says so when there are no notes", () => {
    render(<CustomerNotesEditor customerId="c1" initialNotes={null} />);
    expect(screen.getByText("אין הערות ללקוח זה.")).toBeInTheDocument();
  });

  it("a save shows at once, tells the page, and goes out through the send queue — no page reload", async () => {
    const onSaved = vi.fn();
    render(<CustomerNotesEditor customerId="c1" initialNotes={null} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "עריכת הערות" }));
    fireEvent.change(screen.getByRole("textbox", { name: "הערות ללקוח" }), { target: { value: "להתקשר לפני" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));

    const action = h.scheduleDeferredAction.mock.calls[0]![0] as Deferred;
    action.onApplyOptimistic();
    expect(await screen.findByText("להתקשר לפני")).toBeInTheDocument();
    expect(onSaved).toHaveBeenLastCalledWith("להתקשר לפני");

    await expect(action.onCommit()).resolves.toEqual({ ok: true });
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/customers/update", { id: "c1", notes: "להתקשר לפני" }, "עדכון הערות לקוח");
    expect(refresh).not.toHaveBeenCalled();

    // Undone: back to nothing, and the page hears it too.
    action.onRevert();
    expect(await screen.findByText("אין הערות ללקוח זה.")).toBeInTheDocument();
    expect(onSaved).toHaveBeenLastCalledWith(null);
  });

  it("a refused save comes back as a Hebrew error for the undo engine to show", async () => {
    h.offlineFetch.mockResolvedValueOnce({ queued: false, ok: false, status: 400, error: "boom" } as never);
    render(<CustomerNotesEditor customerId="c1" initialNotes="א" />);
    fireEvent.click(screen.getByRole("button", { name: "עריכת הערות" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    const action = h.scheduleDeferredAction.mock.calls[0]![0] as Deferred;
    const result = await action.onCommit();
    expect(result.ok).toBe(false);
  });

  it("cancel puts the text back without saving; the section's + starts editing", () => {
    const { rerender } = render(<CustomerNotesEditor customerId="c1" initialNotes="א" editRequest={0} />);
    fireEvent.click(screen.getByRole("button", { name: "עריכת הערות" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ב" } });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(screen.getByText("א")).toBeInTheDocument();
    expect(h.scheduleDeferredAction).not.toHaveBeenCalled();

    rerender(<CustomerNotesEditor customerId="c1" initialNotes="א" editRequest={1} />);
    expect(screen.getByRole("textbox")).toHaveValue("א");
  });
});
