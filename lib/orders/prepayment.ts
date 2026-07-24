import { getStatusColorClasses } from "@/lib/ui/status-color-classes";

/**
 * "Pay-ahead" customers (customers.requires_prepayment) are meant to settle in
 * full before we hand goods over. We deliberately DON'T block creating their
 * orders — losing the sale is worse than the risk — so instead an order for such
 * a customer that still has an open balance is flagged bright red everywhere it
 * shows (orders list, customer orders, deliveries queue) as a standing reminder:
 * do not deliver until it's paid. See also the two API routes, which no longer
 * reject these orders.
 */

/** True when a prepayment customer's order still owes money. */
export function isUnpaidPrepayment(
  requiresPrepayment: boolean,
  remainingBalance: number
): boolean {
  return requiresPrepayment && remainingBalance > 0.009;
}

/** Badge text for the flag. */
export const PREPAYMENT_UNPAID_LABEL = "תשלום מראש — לא נגבה";

/** Short warning shown on the order wizard once the customer is a pay-ahead one. */
export const PREPAYMENT_WIZARD_WARNING =
  "לקוח זה מסומן לתשלום מראש. אפשר לשמור את ההזמנה, אך היא תסומן באדום עד לגביית מלוא התשלום — אין לספק לפני התשלום.";

/** Soft-outline red badge classes (design-system danger pill). */
export const prepaymentBadgeClasses = getStatusColorClasses("danger");

/** Tinted red surface for the whole row/card of an unpaid prepayment order. */
export const PREPAYMENT_ROW_CLASSES = "bg-destructive-soft/40 ring-1 ring-inset ring-destructive/40";
