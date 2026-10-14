// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The customer's Morning card. After "יצירת לקוח ב-Morning" it kept saying "לא
// מקושר" with the same button — the page never passed it a way to change
// (2026-10-13) — and a second tap made a second Morning client. Now the card
// holds the link it just made, and its buttons are off while one is running.
// With no connection every Morning action is off, saying why.

const h = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/morning/MorningDocumentsPanel", () => ({
  default: ({ documents }: { documents: unknown[] }) => <div>מסמכי Morning: {documents.length}</div>,
}));
vi.mock("@/components/morning/MorningQuoteDialog", () => ({ default: () => <button type="button">הצעת מחיר חדשה</button> }));

import MorningCustomerCard from "@/components/morning/MorningCustomerCard";

function renderCard(overrides: Partial<Parameters<typeof MorningCustomerCard>[0]> = {}) {
  return render(
    <MorningCustomerCard
      customerId="c1"
      morningClientId={null}
      morningMatchStatus="unmatched"
      morningSyncedAt={null}
      morningLastSyncError={null}
      morningDocuments={[]}
      {...overrides}
    />
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});

afterEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});

describe("MorningCustomerCard", () => {
  it("after a create the card is linked — no second create — and the page hears the new status", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    const onStatusChange = vi.fn();
    renderCard({ onStatusChange });
    expect(screen.getByText("לא מקושר")).toBeInTheDocument();
    expect(onStatusChange).toHaveBeenLastCalledWith({ matchStatus: "unmatched", hasError: false });

    fireEvent.click(screen.getByRole("button", { name: "יצירת לקוח ב-Morning" }));
    // While it runs, nothing else can start — a second tap can't make a second client.
    expect(screen.getByRole("button", { name: "יוצר..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "איתור לקוח Morning" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "יוצר..." }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answer(new Response(JSON.stringify({ morningClient: { id: "mc-77" } }), { status: 200 }));
    expect(await screen.findByText("מקושר")).toBeInTheDocument();
    expect(screen.getByText("mc-77")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "יצירת לקוח ב-Morning" })).toBeNull();
    expect(screen.getByRole("button", { name: "סנכרון פרטי חיוב" })).toBeInTheDocument();
    expect(onStatusChange).toHaveBeenLastCalledWith({ matchStatus: "matched", hasError: false });
  });

  it("a link from the found candidates makes it linked too", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ morningClientId: "mc-1", morningClientName: "אלון בע״מ", score: 0.8, reason: "שם דומה", canAutoMatch: false, email: "a@b.co" }],
            shouldAutoMatch: false,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ morningClient: { id: "mc-1" } }), { status: 200 }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "איתור לקוח Morning" }));
    fireEvent.click(await screen.findByRole("button", { name: "קישור ללקוח זה" }));
    expect(await screen.findByText("מקושר")).toBeInTheDocument();
    expect(screen.queryByText("התאמות אפשריות ב-Morning")).toBeNull();
  });

  it("a failed create says why on the card", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "החשבון ב-Morning לא מחובר" }), { status: 400 }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "יצירת לקוח ב-Morning" }));
    await waitFor(() => expect(screen.getAllByText("החשבון ב-Morning לא מחובר").length).toBeGreaterThan(0));
    // The status pill and the error's own field.
    expect(screen.getAllByText("שגיאת סנכרון")).toHaveLength(2);
  });

  it("states the last sync as a date, not the raw timestamp", () => {
    renderCard({ morningClientId: "mc-5", morningMatchStatus: "matched", morningSyncedAt: "2026-10-12T09:30:00.000Z" });
    expect(screen.queryByText("2026-10-12T09:30:00.000Z")).toBeNull();
    expect(screen.getByText(/^12\/10\/26 \d\d:\d\d$/)).toBeInTheDocument();
  });

  it("with no connection every Morning action is off, saying why", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    renderCard({ morningClientId: "mc-5", morningMatchStatus: "matched" });
    expect(screen.getByText("אין חיבור — פעולות Morning זמינות כשהחיבור חוזר")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "סנכרון פרטי חיוב" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "הצעת מחיר חדשה" })).toBeDisabled();
  });

  it("a sync marks it synced now; a failed one says why", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ morningClient: { id: "mc-5" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "פרטי החיוב חסרים" }), { status: 400 }));
    renderCard({ morningClientId: "mc-5", morningMatchStatus: "matched", morningSyncedAt: null });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "סנכרון פרטי חיוב" }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("פרטי החיוב סונכרנו ל-Morning."));
    expect(screen.getByText(/^\d\d\/\d\d\/\d\d \d\d:\d\d$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סנכרון פרטי חיוב" }));
    expect(await screen.findByText("פרטי החיוב חסרים", { selector: "div" })).toBeInTheDocument();
  });

  it("links by itself when the match is sure, and says when there's none", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ morningClientId: "mc-9", morningClientName: "אלון", score: 1, reason: "ח.פ זהה", canAutoMatch: true }],
            bestCandidate: { morningClientId: "mc-9" },
            shouldAutoMatch: true,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ morningClient: { id: "mc-9" } }), { status: 200 }));
    const { unmount } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "איתור לקוח Morning" }));
    expect(await screen.findByText("מקושר")).toBeInTheDocument();
    expect(screen.getByText("mc-9")).toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "איתור לקוח Morning" }));
    await waitFor(() => expect(h.toast.info).toHaveBeenCalledWith("לא נמצאה התאמה אוטומטית ב-Morning. אפשר ליצור לקוח חדש."));
  });

  it("opens the customer in Morning", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderCard({ morningClientId: "mc-5", morningMatchStatus: "matched" });
    fireEvent.click(screen.getByRole("button", { name: "פתיחה ב-Morning" }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining("mc-5"), "_blank", "noopener,noreferrer");
  });

  it("inside the customer page's section it drops its own frame and title", () => {
    const { container } = renderCard({ bare: true });
    expect(container.firstElementChild?.className).not.toContain("border");
    expect(screen.queryByText("Morning")).toBeNull();
  });
});
