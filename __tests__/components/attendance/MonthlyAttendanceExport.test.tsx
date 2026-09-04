// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import MonthlyAttendanceExport, {
  type MonthlyAttendanceExportItem,
} from "@/components/attendance/MonthlyAttendanceExport";
import type { WorkSessionRow } from "@/lib/payroll";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockAddImage = vi.fn();
vi.mock("jspdf", () => {
  class MockJsPDF {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    addImage = mockAddImage;
    addPage = vi.fn();
    output = vi.fn(() => new Blob(["pdf"], { type: "application/pdf" }));
  }
  return { default: MockJsPDF };
});

// A non-blank fake canvas: isBlankCapture() samples getImageData and bails
// out only when every sampled pixel reads near-white, so filling with zeros
// (black) is what makes the component treat the capture as real content.
vi.mock("html-to-image", () => ({
  toCanvas: vi.fn(async () => ({
    width: 100,
    height: 100,
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4).fill(0) }) }),
    toDataURL: () => "data:image/jpeg;base64,AAAA",
  })),
}));

function makeSession(overrides: Partial<WorkSessionRow>): WorkSessionRow {
  return {
    id: "s1",
    user_id: "u1",
    clock_in: "2026-08-30T12:00:00.000Z",
    clock_out: "2026-08-30T18:00:00.000Z",
    worked_minutes: 480,
    labor_cost: null,
    is_billable_to_customer: null,
    bill_to_customer_amount: null,
    billing_status: null,
    notes: null,
    business_domain: "general_business",
    project_id: null,
    property_id: null,
    ...overrides,
  };
}

const item1: MonthlyAttendanceExportItem = {
  session: makeSession({ id: "s1", notes: "דיווח טלפוני", worked_minutes: 480 }),
};
const item2: MonthlyAttendanceExportItem = {
  session: makeSession({ id: "s2", clock_out: null, worked_minutes: 145, business_domain: "sales" }),
  linkLabel: "פרויקט הובלה",
};

const summary = { totalMinutes: 625, sessionCount: 2, openSessionCount: 1 };

function renderExport() {
  return render(
    <MonthlyAttendanceExport
      workerName="נתן סמוכה"
      monthLabel="אוגוסט 2026"
      summary={summary}
      items={[item1, item2]}
      locale="he"
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
});

describe("MonthlyAttendanceExport — print", () => {
  it("opens a print window with the report title, stats, and every shift row", () => {
    let written = "";
    const fakeWindow = { document: { write: (html: string) => { written = html; }, close: vi.fn() } };
    vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "הדפסה" }));

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(written).toContain('dir="rtl"');
    expect(written).toContain("דוח נוכחות חודשי");
    expect(written).toContain("נתן סמוכה");
    expect(written).toContain("אוגוסט 2026");
    // Stat boxes: total (10:25), shift count (2), open shifts (1).
    expect(written).toContain("10:25");
    expect(written).toContain(">2<");
    expect(written).toContain(">1<");
    // Table headers.
    expect(written).toContain("תאריך");
    expect(written).toContain("שעות");
    expect(written).toContain("שיוך");
    // Row 1: domain label + note + duration.
    expect(written).toContain("שוטף");
    expect(written).toContain("דיווח טלפוני");
    expect(written).toContain("8:00");
    // Row 2: overridden link label wins over the domain label, duration 2:25.
    expect(written).toContain("פרויקט הובלה");
    expect(written).not.toContain("מכירות");
    expect(written).toContain("2:25");
  });

  it("renders the empty state and skips the total row when there are no shifts", () => {
    let written = "";
    const fakeWindow = { document: { write: (html: string) => { written = html; }, close: vi.fn() } };
    vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    render(
      <MonthlyAttendanceExport
        workerName="נתן סמוכה"
        monthLabel="ספטמבר 2026"
        summary={null}
        items={[]}
        locale="he"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "הדפסה" }));

    expect(written).toContain("אין עדיין משמרות בחודש הזה.");
    expect(written).not.toContain("<tfoot>");
  });
});

describe("MonthlyAttendanceExport — share / download", () => {
  it("falls back to a direct download when the Web Share API is unavailable", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    // jsdom logs a "Not implemented: navigation" warning when a real <a> click
    // fires — the component briefly attaches a real anchor to trigger the
    // download, so stub the click itself rather than the navigation it causes.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף / הורדה" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(mockAddImage).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      "ה-PDF נשמר בשם נוכחות - נתן סמוכה - אוגוסט 2026.pdf"
    );
  });

  it("uses navigator.share when the platform supports it, without falling back to a download", async () => {
    const share = vi.fn(async () => {});
    const canShare = vi.fn(() => true);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
    const createObjectURL = vi.fn(() => "blob:mock-url");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף / הורדה" }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const sharedFile = share.mock.calls[0][0].files[0] as File;
    expect(sharedFile.name).toBe("נוכחות - נתן סמוכה - אוגוסט 2026.pdf");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
