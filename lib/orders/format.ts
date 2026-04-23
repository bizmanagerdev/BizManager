import { formatShortDate } from "@/lib/date";

export function formatOrderDate(value: string | null) {
  return formatShortDate(value);
}
