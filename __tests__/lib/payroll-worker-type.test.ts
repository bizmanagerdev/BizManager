import { describe, it, expect } from "vitest";
import {
  isPayrollWorkerType,
  getPayTrackingModeForWorkerType,
  normalizePayrollWorkerType,
  getPayrollWorkerTypeLabel,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeGeneratesPayslips,
  payrollWorkerTypeRequiresAgreement,
  payrollWorkerTypeRequiredAgreementType,
  payrollWorkerTypePaymentAllocationSource,
  shouldShowSessionHours,
  shouldShowSessionPrice,
} from "@/lib/payroll-worker-type";

describe("isPayrollWorkerType", () => {
  it("accepts exactly the three known types", () => {
    expect(isPayrollWorkerType("session_only")).toBe(true);
    expect(isPayrollWorkerType("monthly_payslip")).toBe(true);
    expect(isPayrollWorkerType("hourly_payslip")).toBe(true);
  });
  it("rejects anything else, including null/undefined", () => {
    expect(isPayrollWorkerType("something_else")).toBe(false);
    expect(isPayrollWorkerType(null)).toBe(false);
    expect(isPayrollWorkerType(undefined)).toBe(false);
  });
});

describe("normalizePayrollWorkerType", () => {
  it("passes a valid type straight through", () => {
    expect(normalizePayrollWorkerType("hourly_payslip")).toBe("hourly_payslip");
  });
  it("an invalid value defaults to session_only UNLESS the fallback tracking mode is 'payslip'", () => {
    // The documented gotcha (see profile-split-into-tabs memory): this default
    // is why callers checking "does this worker track sessions?" must NOT use
    // this function — an unset type silently reads as session_only.
    expect(normalizePayrollWorkerType(null)).toBe("session_only");
    expect(normalizePayrollWorkerType(undefined)).toBe("session_only");
    expect(normalizePayrollWorkerType("garbage")).toBe("session_only");
    expect(normalizePayrollWorkerType(null, "payslip")).toBe("monthly_payslip");
    expect(normalizePayrollWorkerType(null, "session")).toBe("session_only");
  });
});

describe("getPayTrackingModeForWorkerType", () => {
  it("session_only tracks sessions; both payslip types track payslip", () => {
    expect(getPayTrackingModeForWorkerType("session_only")).toBe("session");
    expect(getPayTrackingModeForWorkerType("monthly_payslip")).toBe("payslip");
    expect(getPayTrackingModeForWorkerType("hourly_payslip")).toBe("payslip");
  });
});

describe("getPayrollWorkerTypeLabel", () => {
  it("labels each type in Hebrew", () => {
    expect(getPayrollWorkerTypeLabel("session_only")).toBe("קבלנות");
    expect(getPayrollWorkerTypeLabel("hourly_payslip")).toBe("שעתי עם תלוש");
    expect(getPayrollWorkerTypeLabel("monthly_payslip")).toBe("חודשי גלובלי");
  });
});

describe("per-type capability flags — the full 3x truth table", () => {
  it("payrollWorkerTypeAllowsSessions: session_only and hourly_payslip, not monthly_payslip", () => {
    expect(payrollWorkerTypeAllowsSessions("session_only")).toBe(true);
    expect(payrollWorkerTypeAllowsSessions("hourly_payslip")).toBe(true);
    expect(payrollWorkerTypeAllowsSessions("monthly_payslip")).toBe(false);
  });
  it("payrollWorkerTypeGeneratesPayslips: both payslip types, not session_only", () => {
    expect(payrollWorkerTypeGeneratesPayslips("monthly_payslip")).toBe(true);
    expect(payrollWorkerTypeGeneratesPayslips("hourly_payslip")).toBe(true);
    expect(payrollWorkerTypeGeneratesPayslips("session_only")).toBe(false);
  });
  it("payrollWorkerTypeRequiresAgreement mirrors payrollWorkerTypeGeneratesPayslips", () => {
    for (const t of ["session_only", "monthly_payslip", "hourly_payslip"] as const) {
      expect(payrollWorkerTypeRequiresAgreement(t)).toBe(payrollWorkerTypeGeneratesPayslips(t));
    }
  });
  it("payrollWorkerTypeRequiredAgreementType maps to the matching agreement kind, null for session_only", () => {
    expect(payrollWorkerTypeRequiredAgreementType("monthly_payslip")).toBe("monthly");
    expect(payrollWorkerTypeRequiredAgreementType("hourly_payslip")).toBe("hourly");
    expect(payrollWorkerTypeRequiredAgreementType("session_only")).toBeNull();
  });
  it("payrollWorkerTypePaymentAllocationSource: session for session_only, payslip for both others", () => {
    expect(payrollWorkerTypePaymentAllocationSource("session_only")).toBe("session");
    expect(payrollWorkerTypePaymentAllocationSource("monthly_payslip")).toBe("payslip");
    expect(payrollWorkerTypePaymentAllocationSource("hourly_payslip")).toBe("payslip");
  });
});

describe("shouldShowSessionHours / shouldShowSessionPrice", () => {
  it("hides hours only for session_only; hides price only for hourly_payslip", () => {
    expect(shouldShowSessionHours("session_only")).toBe(false);
    expect(shouldShowSessionHours("monthly_payslip")).toBe(true);
    expect(shouldShowSessionHours("hourly_payslip")).toBe(true);

    expect(shouldShowSessionPrice("hourly_payslip")).toBe(false);
    expect(shouldShowSessionPrice("session_only")).toBe(true);
    expect(shouldShowSessionPrice("monthly_payslip")).toBe(true);
  });
  it("null/undefined is treated as showing both (not session_only, not hourly_payslip)", () => {
    expect(shouldShowSessionHours(null)).toBe(true);
    expect(shouldShowSessionPrice(undefined)).toBe(true);
  });
});
