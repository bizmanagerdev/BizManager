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
  "id,payment_date,amount_total,payment_method,reference_number,check_number,amount_including_vat,amount_before_vat,net_amount,payment_status,business_domain,project_id,order_id,property_id,due_date,requires_split,recorded_by,notes,created_at,updated_at";

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
};

function normalizePaymentMethod(method: string) {
  return method.trim().toLowerCase();
}

function defaultPaymentStatusForMethod(method: string) {
  return normalizePaymentMethod(method) === "check" ? "pending" : "cleared";
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildPaymentInsert(input: BuildPaymentInsertInput) {
  const paymentStatus =
    input.paymentStatus ?? defaultPaymentStatusForMethod(input.paymentMethod);
  const dueDate =
    input.dueDate ??
    (normalizePaymentMethod(input.paymentMethod) === "check" ? input.paymentDate : null);
  const requiresSplit = input.requiresSplit ?? false;
  const amountTotal = roundMoney(input.amountTotal);
  const amountBeforeVat = requiresSplit ? roundMoney(amountTotal / 1.18) : null;
  const amountIncludingVat = requiresSplit ? amountTotal : null;
  const netAmount = requiresSplit ? amountBeforeVat : amountTotal;

  return {
    payment_date: input.paymentDate,
    amount_total: amountTotal,
    payment_method: input.paymentMethod,
    reference_number: input.referenceNumber ?? null,
    check_number: input.checkNumber ?? null,
    amount_including_vat: amountIncludingVat,
    amount_before_vat: amountBeforeVat,
    net_amount: netAmount,
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
