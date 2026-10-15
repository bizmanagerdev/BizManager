import { formatDayMonth, formatShortDate, formatTimeOnly } from "@/lib/date";

export function formatOrderDate(value: string | null) {
  return formatShortDate(value);
}

/**
 * When an order was typed in (created_at), short enough to sit beside its day
 * in a list: just "15:32" when it was entered on the order's own day, else
 * "12/10 15:32". null without a created_at (owner, 2026-10-15: "see exactly
 * when things happen").
 */
export function formatOrderEnteredShort(orderDate: string | null, createdAt: string | null) {
  if (!createdAt) return null;
  const time = formatTimeOnly(createdAt, "");
  if (!time) return null;
  if (orderDate && formatShortDate(orderDate) === formatShortDate(createdAt)) return time;
  return `${formatDayMonth(createdAt)} ${time}`;
}
