// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import WorkerSummaryExport from "@/components/payroll/WorkerSummaryExport";
import {
  formatCurrency,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";
import type { MyPaymentAllocationRow, MyPaymentRow } from "@/lib/my-payroll";

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

const mockToCanvas = vi.fn(async () => ({
  width: 100,
  height: 100,
  getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4).fill(0) }) }),
  toDataURL: () => "data:image/jpeg;base64,AAAA",
}));
vi.mock("html-to-image", () => ({ toCanvas: mockToCanvas }));

function makeSession(overrides: Partial<WorkSessionRow>): WorkSessionRow {
  return {
    id: "s1",
    user_id: "u1",
    clock_in: "2026-08-10T12:00:00.000Z",
    clock_out: "2026-08-10T16:00:00.000Z",
    worked_minutes: 240,
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

const agreements: SalaryAgreementRow[] = [
  {
    id: "a1",
    user_id: "u1",
    salary_type: "hourly",
    hourly_rate: 60,
    monthly_salary: null,
    valid_from: "2020-01-01",
    valid_to: null,
    notes: null,
    overtime_rate: null,
    standard_daily_hours: 8,
    due_day_of_next_month: null,
    business_domain: null,
    project_id: null,
    property_id: null,
    is_billable_to_customer: null,
    bill_to_customer_amount: null,
  },
];

// s1: 4h, labor_cost 240 (paid in full via pay1). s2: 2.5h, labor_cost 150
// (unpaid — no allocation targets it). A payslip item settled inside August's
// payroll (via pay1's other allocation) adds 50 more paid.
const selectedMonthSessions: WorkSessionRow[] = [
  makeSession({ id: "s1", notes: "משמרת בוקר", labor_cost: 240 }),
  makeSession({
    id: "s2",
    clock_in: "2026-08-15T12:00:00.000Z",
    clock_out: "2026-08-15T14:30:00.000Z",
    worked_minutes: 150,
    labor_cost: 150,
    business_domain: "sales",
  }),
];

// One payslip, settled inside August's payroll period — this is what lets a
// payslip-allocated payment count toward August in the report below.
const payslips: PayslipRow[] = [
  {
    id: "p1",
    payroll_period_id: "period1",
    user_id: "u1",
    calculated_salary_type: "hourly",
    total_work_minutes: 0,
    calculated_base_salary: 0,
    manual_adjustments: 0,
    gross_salary: 50,
    notes: null,
  },
];
const periods: PayrollPeriodRow[] = [
  { id: "period1", period_month: "2026-08", start_date: "2026-08-01", end_date: "2026-08-31", status: "closed" },
];

const payments: MyPaymentRow[] = [
  { id: "pay1", paymentDate: "2026-08-20", amount: 290, method: "cash", referenceNumber: null, notes: "מזומן בסוף החודש" },
  { id: "pay2", paymentDate: "2026-07-01", amount: 500, method: "transfer", referenceNumber: "REF1", notes: null },
];

const paymentAllocations: MyPaymentAllocationRow[] = [
  { workerPaymentId: "pay1", sourceType: "session", attendanceSessionId: "s1", payslipId: null, amount: 240 },
  { workerPaymentId: "pay1", sourceType: "payslip", attendanceSessionId: null, payslipId: "p1", amount: 50 },
  // A different month's session — pay2 must NOT show up in an August-scoped report.
  { workerPaymentId: "pay2", sourceType: "session", attendanceSessionId: "s-other", payslipId: null, amount: 500 },
];

function renderExport() {
  return render(
    <WorkerSummaryExport
      workerName="נתן סמוכה"
      workerPhone="0583283656"
      monthLabel="אוגוסט 2026"
      monthKey="2026-08"
      selectedMonthSessions={selectedMonthSessions}
      linkLabelBySessionId={{ s2: "פרויקט מכירות" }}
      agreements={agreements}
      payslips={payslips}
      periods={periods}
      payments={payments}
      paymentAllocations={paymentAllocations}
      locale="he"
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  // Always restored, even if a test fails mid-way: leaving fake timers active
  // hangs every later test's `waitFor` (real-time polling never advances).
  vi.useRealTimers();
  document.querySelectorAll("[data-worker-summary-print]").forEach((el) => el.remove());
});

describe("WorkerSummaryExport — print", () => {
  it("renders the same report shape as the admin's worker summary, scoped to this worker's month", () => {
    let written = "";
    const fakeWindow = { document: { open: vi.fn(), write: (html: string) => { written = html; }, close: vi.fn() }, focus: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "הדפסה" }));

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(written).toContain('dir="rtl"');
    expect(written).toContain("סיכום עבודה ותשלומים לעובד");
    expect(written).toContain("נתן סמוכה");
    expect(written).toContain("0583283656");
    expect(written).toContain("חודש: אוגוסט 2026");

    // Summary cards: earned = 240 + 150 = 390; paid = 240 (s1) + 0 (s2) + 50
    // (payslip settled in August) = 290; owed = 390 - 290 = 100.
    expect(written).toContain(formatCurrency(390));
    expect(written).toContain(formatCurrency(290));
    expect(written).toContain(formatCurrency(100));

    // Hourly columns + notes column both present (at least one hourly session, at least one note).
    expect(written).toContain("שעת התחלה");
    expect(written).toContain("שעת סיום");
    // The table content lives inside an embedded JSON blob (built client-side
    // by the pagination script), where JSON.stringify escapes '"' to '\"' —
    // match the substring on the side that doesn't cross that quote.
    expect(written).toContain('כ שעות');
    expect(written).toContain("תעריף שעתי");
    expect(written).toContain("פרויקט / נכס");
    expect(written).toContain("עלות עבודה");
    expect(written).toContain("הערות");

    // Row 1: domain fallback label, duration, hourly rate, note, per-session earned.
    expect(written).toContain("שוטף");
    expect(written).toContain("4:00");
    expect(written).toContain(`${formatCurrency(60)} / שעה`);
    expect(written).toContain("משמרת בוקר");
    expect(written).toContain(formatCurrency(240));

    // Row 2: explicit link label wins over the domain label ("מכירות").
    expect(written).toContain("פרויקט מכירות");
    expect(written).toContain("2:30");
    expect(written).toContain(formatCurrency(150));

    // Payments table: only pay1 (scoped to August via its allocations) shows;
    // pay2 (allocated to a different month's session) is excluded entirely.
    expect(written).toContain("פירוט תשלומים");
    expect(written).toContain("מזומן");
    expect(written).toContain("מזומן בסוף החודש");
    expect(written).not.toContain("REF1");
  });

  it("shows the non-hourly, no-notes column set and the empty states when there is nothing to report", () => {
    let written = "";
    const fakeWindow = { document: { open: vi.fn(), write: (html: string) => { written = html; }, close: vi.fn() }, focus: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    render(
      <WorkerSummaryExport
        workerName="נתן סמוכה"
        workerPhone={null}
        monthLabel="ספטמבר 2026"
        monthKey="2026-09"
        selectedMonthSessions={[]}
        linkLabelBySessionId={{}}
        agreements={[]}
        payslips={[]}
        periods={[]}
        payments={[]}
        paymentAllocations={[]}
        locale="he"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "הדפסה" }));

    expect(written).toContain("אין משמרות לחודש שנבחר.");
    expect(written).toContain("אין תשלומים רשומים לחודש שנבחר.");
    expect(written).not.toContain("שעת התחלה");
  });
});

describe("WorkerSummaryExport — share / download", () => {
  it("falls back to a direct download when the Web Share API is unavailable", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף / הורדה" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(mockAddImage).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("ה-PDF נשמר בשם סיכום עבודה - נתן סמוכה - אוגוסט 2026.pdf");
    // The temporary content-CSS <style> tag is cleaned up afterward.
    expect(document.querySelector("[data-worker-summary-print]")).toBeNull();
  });

  it("surfaces an error and re-enables the button instead of spinning forever when the capture never settles", async () => {
    vi.useFakeTimers();
    // Simulates the real bug: html-to-image's toCanvas() hung indefinitely in
    // the packaged Android WebView, leaving the share button spinning forever.
    mockToCanvas.mockImplementationOnce(() => new Promise(() => {}));

    renderExport();
    const button = screen.getByRole("button", { name: "שיתוף / הורדה" });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(toast.error).toHaveBeenCalledWith("יצירת ה-PDF נמשכה זמן רב מדי. נסו שוב.");
    // waitFor polls on real timers — switch back before using it, so its own
    // polling isn't stuck behind the fake clock this test installed.
    vi.useRealTimers();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("uses navigator.share when the platform supports it, without falling back to a download", async () => {
    const share = vi.fn(async (_data: { files: File[] }) => {});
    const canShare = vi.fn(() => true);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
    const createObjectURL = vi.fn(() => "blob:mock-url");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף / הורדה" }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const sharedFile = share.mock.calls[0]?.[0]?.files[0];
    expect(sharedFile?.name).toBe("סיכום עבודה - נתן סמוכה - אוגוסט 2026.pdf");
    expect(createObjectURL).not.toHaveBeenCalled();

    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "canShare");
  });
});
