import type { ExpenseBusinessDomain } from "@/lib/expenses";

export type PaymentRow = {
  id: string;
  payment_date: string | null;
  amount_total: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
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
};

export const PAYMENT_SELECT =
  "id,payment_date,amount_total,payment_method,reference_number,amount_including_vat,amount_before_vat,net_amount,payment_status,business_domain,project_id,order_id,property_id,due_date,requires_split,recorded_by,notes,created_at,updated_at";

type BuildPaymentInsertInput = {
  amountTotal: number;
  businessDomain: ExpenseBusinessDomain;
  orderId?: string | null;
  paymentDate: string;
  paymentMethod: string;
  projectId?: string | null;
  propertyId?: string | null;
  recordedBy: string;
  referenceNumber?: string | null;
  notes?: string | null;
};

export function buildPaymentInsert(input: BuildPaymentInsertInput) {
  return {
    payment_date: input.paymentDate,
    amount_total: input.amountTotal,
    payment_method: input.paymentMethod,
    reference_number: input.referenceNumber ?? null,
    amount_including_vat: input.amountTotal,
    amount_before_vat: input.amountTotal,
    net_amount: input.amountTotal,
    payment_status: "paid",
    business_domain: input.businessDomain,
    project_id: input.projectId ?? null,
    order_id: input.orderId ?? null,
    property_id: input.propertyId ?? null,
    due_date: null,
    requires_split: false,
    notes: input.notes ?? null,
    recorded_by: input.recordedBy,
  };
}
