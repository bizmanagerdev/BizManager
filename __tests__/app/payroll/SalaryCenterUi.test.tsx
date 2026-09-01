// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AccessBadge,
  PaymentStatusBadge,
  RoleBadge,
  WorkerTypeBadge,
  escapePrintHtml,
  formatMonthYearLabel,
  formatPrintPeriodLabel,
  formatSessionRange,
  formatWorkerPaymentMethodLabel,
} from "@/app/(app)/payroll/SalaryCenterUi";

describe("formatSessionRange", () => {
  it("shows an open ('still clocked in') session with no end time", () => {
    expect(formatSessionRange("2026-09-17T08:00:00", null)).toBe("17.09.26 • 08:00 - פתוח");
  });

  it("shows a same-day session as one date with a time range", () => {
    expect(formatSessionRange("2026-09-17T08:00:00", "2026-09-17T16:30:00")).toBe(
      "17.09.26 • 08:00-16:30"
    );
  });

  it("shows a session spanning midnight with both dates", () => {
    expect(formatSessionRange("2026-09-17T22:00:00", "2026-09-18T06:00:00")).toBe(
      "17.09.26 22:00 → 18.09.26 06:00"
    );
  });
});

describe("formatMonthYearLabel / formatPrintPeriodLabel", () => {
  it("formats a valid month/year as a Hebrew month name", () => {
    expect(formatMonthYearLabel("2026", "9")).toContain("2026");
  });

  it("falls back to 'month/year' for an out-of-range month", () => {
    expect(formatMonthYearLabel("2026", "13")).toBe("13/2026");
  });

  it("describes the print period across all four filter combinations", () => {
    expect(formatPrintPeriodLabel("", "")).toBe("כל החודשים והשנים");
    expect(formatPrintPeriodLabel("2026", "")).toBe("כל החודשים בשנת 2026");
    expect(formatPrintPeriodLabel("", "9")).toContain("בכל השנים");
    expect(formatPrintPeriodLabel("2026", "9")).toContain("2026");
  });
});

describe("escapePrintHtml", () => {
  it("escapes the five HTML-sensitive characters", () => {
    expect(escapePrintHtml(`<b>"it's" & fun</b>`)).toBe(
      "&lt;b&gt;&quot;it&#39;s&quot; &amp; fun&lt;/b&gt;"
    );
  });
});

describe("formatWorkerPaymentMethodLabel", () => {
  it("maps common payment-method spellings to Hebrew, case-insensitively", () => {
    expect(formatWorkerPaymentMethodLabel("Cash")).toBe("מזומן");
    expect(formatWorkerPaymentMethodLabel("bank transfer")).toBe("העברה");
    expect(formatWorkerPaymentMethodLabel("cheque")).toBe("צ׳ק");
  });

  it("passes an unrecognized value through as-is, and blanks through empty", () => {
    expect(formatWorkerPaymentMethodLabel("bit")).toBe("ביט");
    expect(formatWorkerPaymentMethodLabel("  ")).toBe("");
    expect(formatWorkerPaymentMethodLabel(null)).toBe("");
  });
});

describe("PaymentStatusBadge", () => {
  it("shows 'overpaid' when the owed amount is negative, regardless of the status field", () => {
    render(<PaymentStatusBadge status="pending" owedAmount={-50} />);
    expect(screen.getByText("שולם יתר")).toBeInTheDocument();
  });

  it("shows 'paid' once owed is at/under zero (within tolerance), regardless of the status field", () => {
    render(<PaymentStatusBadge status="partial" owedAmount={0.005} />);
    expect(screen.getByText("שולם")).toBeInTheDocument();
  });

  it("otherwise reflects the given status, defaulting an unrecognized one to unpaid", () => {
    render(<PaymentStatusBadge status="partial" owedAmount={100} />);
    expect(screen.getByText("שולם חלקית")).toBeInTheDocument();
  });
});

describe("badges derived from the shared StatusPill", () => {
  it("WorkerTypeBadge / RoleBadge render their Hebrew labels", () => {
    render(<WorkerTypeBadge workerType="hourly_payslip" />);
    render(<RoleBadge role="admin" />);
    expect(screen.getByText("שעתי עם תלוש")).toBeInTheDocument();
    expect(screen.getByText("מנהל")).toBeInTheDocument();
  });

  it("AccessBadge reflects hasAccess", () => {
    const { rerender } = render(<AccessBadge hasAccess={false} />);
    expect(screen.getByText("ללא גישה")).toBeInTheDocument();
    rerender(<AccessBadge hasAccess />);
    expect(screen.getByText("עם גישה")).toBeInTheDocument();
  });
});
