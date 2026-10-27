import { isExpenseBusinessDomain, type ExpenseBusinessDomain } from "@/lib/expenses";
import type { CurrencyPricing } from "@/lib/fx/money-input";

// An expense as the expense forms send it — read and checked the SAME way on
// the server (app/api/expenses/create) and on the phone (lib/financial/
// device-bank-saves.ts, the accounts page's quick line saving on the device
// copy first), and made into its row by the same builder. Income has the same
// pair in lib/payments/payment-input.ts.

export type ExpenseBody = {
  id?: unknown;
  project_id?: string | null;
  order_id?: string | null;
  property_id?: string | null;
  business_domain?: string;
  amount?: number | string;
  category?: string;
  description?: string;
  notes?: string;
  expense_date?: string | null;
  included_in_base_price?: boolean;
  billed_to_customer?: boolean;
  bill_to_customer_amount?: number | string | null;
  project_expense_notes?: string;
  payment_status?: string | null;
  paid_amount?: number | string | null;
  payment_method?: string | null;
  account_id?: string | null;
  tag_ids?: unknown;
};

export type ExpenseFields = {
  projectId: string;
  orderId: string;
  propertyId: string;
  /** As sent ("" when missing: a project's type decides it). */
  businessDomain: string;
  /** As typed — in the row's currency. */
  amount: number;
  category: string;
  description: string | null;
  notes: string | null;
  expenseDate: string;
  includedInBasePrice: boolean;
  billedToCustomer: boolean;
  projectExpenseNotes: string | null;
  paymentStatus: "paid" | "partial" | "not_paid" | null;
  /** As typed — only for a partly paid expense. */
  paidAmount: number | null;
  paymentMethod: string | null;
  accountId: string | null;
};

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The expense's fields, or why it can't be saved. */
export function expenseFieldsFrom(body: ExpenseBody): ExpenseFields | { error: string } {
  const projectId = trimmed(body.project_id);
  const orderId = trimmed(body.order_id);
  const propertyId = trimmed(body.property_id);
  const category = trimmed(body.category);
  const amount =
    typeof body.amount === "number" ? body.amount : typeof body.amount === "string" ? Number(body.amount) : NaN;

  if (!category || !Number.isFinite(amount)) return { error: "יש להזין קטגוריה וסכום." };

  const expenseDate = typeof body.expense_date === "string" ? body.expense_date : null;
  if (!expenseDate) return { error: "יש להזין תאריך להוצאה." };

  if ([projectId, orderId, propertyId].filter(Boolean).length > 1) {
    return { error: "ניתן לשייך הוצאה למקור אחד בלבד (פרויקט / הזמנה / נכס)." };
  }

  const rawPaymentStatus = trimmed(body.payment_status);
  const paymentStatus =
    rawPaymentStatus === "paid" || rawPaymentStatus === "partial" || rawPaymentStatus === "not_paid"
      ? rawPaymentStatus
      : null;
  const rawPaidAmount = body.paid_amount != null ? Number(body.paid_amount) : null;
  const paidAmount =
    paymentStatus === "partial" && rawPaidAmount != null && Number.isFinite(rawPaidAmount) && rawPaidAmount > 0
      ? rawPaidAmount
      : null;

  return {
    projectId,
    orderId,
    propertyId,
    businessDomain: trimmed(body.business_domain),
    amount,
    category,
    description: typeof body.description === "string" ? body.description.trim() : null,
    notes: typeof body.notes === "string" ? body.notes.trim() : null,
    expenseDate,
    includedInBasePrice: Boolean(body.included_in_base_price),
    billedToCustomer: Boolean(body.billed_to_customer),
    projectExpenseNotes: typeof body.project_expense_notes === "string" ? body.project_expense_notes.trim() : null,
    paymentStatus,
    paidAmount,
    paymentMethod: trimmed(body.payment_method) || null,
    accountId: trimmed(body.account_id) || null,
  };
}

/** The expense's domain once its link is known (`domain`: as sent, or from its project), or why it can't be saved. */
export function expenseDomainFrom(
  domain: string,
  fields: Pick<ExpenseFields, "projectId" | "propertyId">
): { domain: ExpenseBusinessDomain } | { error: string } {
  if (!isExpenseBusinessDomain(domain)) return { error: "יש לבחור תחום עסקי." };
  if (domain === "property_management" && !fields.propertyId) return { error: "יש לבחור נכס לתחום ניהול נכסים." };
  if (domain === "logistics_projects" && !fields.projectId) return { error: "יש לבחור פרויקט לתחום פרויקטים." };
  return { domain };
}

/** The expense's row (without its id): its amounts in shekels at `pricing`'s rate, its currency beside them. */
export function expenseRowFrom(
  fields: ExpenseFields,
  context: { businessDomain: ExpenseBusinessDomain; recordedBy: string; pricing: Pick<CurrencyPricing, "columns" | "toShekels"> }
) {
  const { pricing } = context;
  const paid = fields.paymentStatus === "paid" || fields.paymentStatus === "partial";
  return {
    expense_date: fields.expenseDate,
    amount: pricing.toShekels(fields.amount),
    category: fields.category,
    description: fields.description,
    business_domain: context.businessDomain,
    project_id: fields.projectId || null,
    order_id: fields.orderId || null,
    property_id: fields.propertyId || null,
    notes: fields.notes,
    recorded_by: context.recordedBy,
    payment_status: fields.paymentStatus,
    paid_amount: fields.paidAmount === null ? null : pricing.toShekels(fields.paidAmount),
    payment_method: paid ? fields.paymentMethod : null,
    account_id: fields.accountId,
    ...(pricing.columns ?? {}),
  };
}
