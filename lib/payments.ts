import type { ExpenseBusinessDomain } from "@/lib/expenses";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { getPaymentStatusColor, getPaymentStatusLabel } from "@/lib/ui/status-colors";

export type FinancialAttachment = {
  document_id: string;
  file_name: string | null;
  storage_key?: string | null;
  uploaded_at?: string | null;
  url: string | null;
  document_type?: string | null;
};

export type PaymentRow = {
  id: string;
  payment_date: string | null;
  amount_total: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
  check_number: string | null;
  amount_including_vat: number | string | null;
  amount_before_vat: number | string | null;
  net_amount: number | string | null;
  vat_amount: number | string | null;
  vat_rate: number | string | null;
  payment_status: string | null;
  business_domain: ExpenseBusinessDomain | string | null;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  due_date: string | null;
  requires_split: boolean | null;
  recorded_by: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  attachments?: FinancialAttachment[];
};

export const PAYMENT_SELECT =
  "id,payment_date,amount_total,payment_method,reference_number,check_number,amount_including_vat,amount_before_vat,net_amount,vat_amount,vat_rate,payment_status,business_domain,project_id,order_id,property_id,due_date,requires_split,recorded_by,notes,created_at,updated_at";

// Single source of truth for the payment-method dropdown, shared by both the
// expense dialog and the order/project payment dialogs so they always match.
// Values must stay in sync with paymentMethodLabel() in lib/orders/paymentStatus.
export const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "מזומן" },
  { value: "bank_transfer", label: "העברה בנקאית" },
  { value: "credit_card", label: "כרטיס אשראי" },
  { value: "check", label: "צ'ק" },
  { value: "other", label: "אחר" },
] as const;

type BuildPaymentInsertInput = {
  amountTotal: number;
  businessDomain: ExpenseBusinessDomain;
  orderId?: string | null;
  paymentDate: string;
  paymentMethod: string;
  paymentStatus?: "pending" | "cleared" | "rejected";
  projectId?: string | null;
  propertyId?: string | null;
  recordedBy: string;
  referenceNumber?: string | null;
  checkNumber?: string | null;
  notes?: string | null;
  dueDate?: string | null;
  requiresSplit?: boolean;
  /**
   * VAT rate to apply when requiresSplit (official payment). Fraction, e.g. 0.18.
   * Frozen onto the row so a later rate change never alters this payment.
   * Defaults to 0.18 if omitted (legacy callers).
   */
  vatRate?: number;
};

export const DEFAULT_PAYMENT_VAT_RATE = 0.18;

function normalizePaymentMethod(method: string) {
  return method.trim().toLowerCase();
}

function defaultPaymentStatusForMethod(
  method: string,
  paymentDate: string,
  dueDate: string | null
): "pending" | "cleared" {
  if (normalizePaymentMethod(method) === "check") return "pending";
  // Non-check method with a due_date that is today or in the future — treat as pending.
  // Compare against today so that paymentDate == dueDate (both set to a future date) is
  // correctly treated as pending, not cleared.
  if (dueDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (dueDate > today) return "pending";
  }
  return "cleared";
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildPaymentInsert(input: BuildPaymentInsertInput) {
  const dueDate =
    input.dueDate ??
    (normalizePaymentMethod(input.paymentMethod) === "check" ? input.paymentDate : null);
  const paymentStatus =
    input.paymentStatus ??
    defaultPaymentStatusForMethod(input.paymentMethod, input.paymentDate, dueDate);
  const requiresSplit = input.requiresSplit ?? false;
  // Fraction (0.18). Frozen onto the row so later rate changes don't touch it.
  const vatRate =
    requiresSplit && typeof input.vatRate === "number" && Number.isFinite(input.vatRate) && input.vatRate >= 0
      ? input.vatRate
      : DEFAULT_PAYMENT_VAT_RATE;
  const amountTotal = roundMoney(input.amountTotal);
  // Official: strip VAT — only the pre-VAT (net) part counts toward the price.
  // Non-official: the whole amount counts, no VAT.
  const amountBeforeVat = requiresSplit ? roundMoney(amountTotal / (1 + vatRate)) : null;
  const amountIncludingVat = requiresSplit ? amountTotal : null;
  const netAmount = requiresSplit ? (amountBeforeVat as number) : amountTotal;
  const vatAmount = requiresSplit ? roundMoney(amountTotal - (amountBeforeVat as number)) : 0;

  return {
    payment_date: input.paymentDate,
    amount_total: amountTotal,
    payment_method: input.paymentMethod,
    reference_number: input.referenceNumber ?? null,
    check_number: input.checkNumber ?? null,
    amount_including_vat: amountIncludingVat,
    amount_before_vat: amountBeforeVat,
    net_amount: netAmount,
    vat_amount: vatAmount,
    vat_rate: requiresSplit ? vatRate : 0,
    payment_status: paymentStatus,
    business_domain: input.businessDomain,
    project_id: input.projectId ?? null,
    order_id: input.orderId ?? null,
    property_id: input.propertyId ?? null,
    due_date: dueDate,
    requires_split: requiresSplit,
    notes: input.notes ?? null,
    recorded_by: input.recordedBy,
  };
}

export function paymentRecordStatusLabel(status: string | null | undefined) {
  return getPaymentStatusLabel(status ?? "");
}

export function paymentRecordStatusClasses(status: string | null | undefined) {
  return getStatusColorClasses(getPaymentStatusColor(status ?? ""));
}
