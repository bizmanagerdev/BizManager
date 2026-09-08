import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getStatusColor, getStatusLabel, type StatusBadgeType } from "@/lib/ui/status-colors";
import type { StatusColor } from "@/lib/ui/status-colors";
import type { Locale } from "@/lib/i18n/types";
import { formatDayMonth } from "@/lib/date";

const VARIANT_BY_COLOR: Record<StatusColor, "success" | "warning" | "destructive" | "info" | "neutral"> = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
  neutral: "neutral",
};

export function StatusBadge({
  value,
  type,
  className,
  locale = "he",
  dueDate,
}: {
  value: string;
  type: StatusBadgeType;
  className?: string;
  locale?: Locale;
  /** A payment badge whose value is "not_due": composes "צפוי <date>" instead
   *  of the generic "צפוי" fallback, so the badge answers WHEN rather than
   *  just "not yet" — same vocabulary as the rest of the app's "צפוי" wording. */
  dueDate?: string | null;
}) {
  const color = getStatusColor(type, value);
  const isNotDue = type === "payment" && value.trim().toLowerCase() === "not_due";
  const label =
    isNotDue && dueDate ? `צפוי ${formatDayMonth(dueDate)}` : getStatusLabel(type, value, locale);

  return (
    <Badge variant={VARIANT_BY_COLOR[color]} className={cn(className)}>
      {label}
    </Badge>
  );
}
