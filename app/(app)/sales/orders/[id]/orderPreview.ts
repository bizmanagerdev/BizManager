import { createPreviewSlot } from "@/lib/ui/preview-slot";

// What the orders list already knows about an order — whose it is — handed to
// the order page for the moment between a tap on the row and the page's own
// data arriving. The page's loading screen names the order from this (the
// phone's top bar, the desktop heading) instead of grey bars only
// (OrderPageLoading, and RouteOpeningOverlay over the list).

export type OrderPreview = {
  id: string;
  customerId: string | null;
  /** The customer's name alone — the heading's text when there's no customer link. */
  customerName: string;
  /** The name with " · סניף …" when the order is for one of the customer's branches. */
  customerDisplayName: string;
};

export const orderPreviewSlot = createPreviewSlot<OrderPreview>();

/** An orders-list row as a preview, or null when it has no id. */
export function orderPreviewFromRow(row: {
  id: string;
  customerId: string | null;
  customerName: string;
  customerBranchName: string | null;
}): OrderPreview | null {
  if (!row.id) return null;
  return {
    id: row.id,
    customerId: row.customerId || null,
    customerName: row.customerName,
    customerDisplayName: row.customerBranchName
      ? `${row.customerName} · סניף ${row.customerBranchName}`
      : row.customerName,
  };
}
