import { buildPaymentInsert } from "@/lib/payments";
import { isExpenseBusinessDomain, type ExpenseBusinessDomain } from "@/lib/expenses";

// A payment (income) as the income forms send it — read and checked the SAME
// way on the server (app/api/payments/create) and on the phone
// (lib/payments/device-payment-saves.ts, saving a project's income on the
// device copy first), and made into its row by the same builder.

export type PaymentBody = {
  id?: unknown;
  business_domain?: unknown;
  project_id?: unknown;
  order_id?: unknown;
  property_id?: unknown;
  payment_date?: unknown;
  due_date?: unknown;
  amount_total?: unknown;
  requires_split?: unknown;
  payment_method?: unknown;
  reference_number?: unknown;
  check_number?: unknown;
  notes?: unknown;
  account_id?: unknown;
  tag_ids?: unknown;
};

export type PaymentFields = {
  amount: number;
  paymentDate: string;
  dueDate: string | null;
  paymentMethod: string;
  referenceNumber: string | null;
  checkNumber: string | null;
  notes: string | null;
  projectId: string;
  orderId: string;
  propertyId: string;
  requiresSplit: boolean;
  accountId: string | null;
  /** As sent; when missing, the server (or the phone) works it out from what it's linked to. */
  businessDomain: ExpenseBusinessDomain | null;
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The payment's fields, or why it can't be saved. */
export function paymentFieldsFrom(body: PaymentBody): PaymentFields | { error: string } {
  const paymentDate = typeof body.payment_date === "string" ? body.payment_date : null;
  const dueDate = typeof body.due_date === "string" ? body.due_date : null;
  const paymentMethod = trimmed(body.payment_method);
  const amount = toNumber(body.amount_total);
  const projectId = trimmed(body.project_id);
  const orderId = trimmed(body.order_id);
  const propertyId = trimmed(body.property_id);

  if (!Number.isFinite(amount) || amount <= 0) return { error: "Missing or invalid amount_total" };
  if (!paymentDate || !paymentMethod) return { error: "Missing payment_date or payment_method" };
  if (paymentMethod === "check" && !dueDate) return { error: "Missing due_date for check payment" };
  if ([projectId, orderId, propertyId].filter(Boolean).length > 1) {
    return { error: "Only one of project_id, order_id, or property_id can be provided" };
  }

  return {
    amount,
    paymentDate,
    dueDate,
    paymentMethod,
    referenceNumber: typeof body.reference_number === "string" ? body.reference_number.trim() : null,
    checkNumber: trimmed(body.check_number) || null,
    notes: typeof body.notes === "string" ? body.notes.trim() : null,
    projectId,
    orderId,
    propertyId,
    requiresSplit: body.requires_split === true,
    accountId: trimmed(body.account_id) || null,
    businessDomain:
      typeof body.business_domain === "string" && isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null,
  };
}

/** The payment's row (without its id). `vatRate`: the rate an official payment freezes. */
export function paymentRowFrom(
  fields: PaymentFields,
  context: { businessDomain: ExpenseBusinessDomain; vatRate: number | undefined; recordedBy: string }
) {
  return buildPaymentInsert({
    amountTotal: fields.amount,
    businessDomain: context.businessDomain,
    paymentDate: fields.paymentDate,
    paymentMethod: fields.paymentMethod,
    projectId: fields.projectId || null,
    orderId: fields.orderId || null,
    propertyId: fields.propertyId || null,
    referenceNumber: fields.referenceNumber,
    checkNumber: fields.paymentMethod === "check" ? fields.checkNumber : null,
    notes: fields.notes,
    dueDate: fields.dueDate,
    requiresSplit: fields.requiresSplit,
    vatRate: context.vatRate,
    recordedBy: context.recordedBy,
    accountId: fields.accountId,
  });
}
