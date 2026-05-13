export type PayrollWorkerType = "session_only" | "monthly_payslip" | "hourly_payslip";

export function isPayrollWorkerType(value: unknown): value is PayrollWorkerType {
  return value === "session_only" || value === "monthly_payslip" || value === "hourly_payslip";
}

export function getPayTrackingModeForWorkerType(workerType: PayrollWorkerType): "session" | "payslip" {
  return workerType === "session_only" ? "session" : "payslip";
}

export function normalizePayrollWorkerType(
  value: unknown,
  fallbackPayTrackingMode?: string | null
): PayrollWorkerType {
  if (isPayrollWorkerType(value)) return value;
  if (fallbackPayTrackingMode === "payslip") return "monthly_payslip";
  return "session_only";
}

export function getPayrollWorkerTypeLabel(workerType: PayrollWorkerType) {
  if (workerType === "session_only") return "קבלנות לפי משמרות";
  if (workerType === "hourly_payslip") return "שעתי עם תלוש";
  return "חודשי גלובלי";
}

export function payrollWorkerTypeAllowsSessions(workerType: PayrollWorkerType) {
  return workerType === "session_only" || workerType === "hourly_payslip";
}

export function payrollWorkerTypeGeneratesPayslips(workerType: PayrollWorkerType) {
  return workerType === "monthly_payslip" || workerType === "hourly_payslip";
}

export function payrollWorkerTypeRequiresAgreement(workerType: PayrollWorkerType) {
  return workerType === "monthly_payslip" || workerType === "hourly_payslip";
}

export function payrollWorkerTypeRequiredAgreementType(workerType: PayrollWorkerType) {
  if (workerType === "monthly_payslip") return "monthly";
  if (workerType === "hourly_payslip") return "hourly";
  return null;
}

export function payrollWorkerTypePaymentAllocationSource(workerType: PayrollWorkerType): "session" | "payslip" {
  return workerType === "session_only" ? "session" : "payslip";
}
