import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getStatusColor, getStatusLabel, type StatusBadgeType, type Gender } from "@/lib/ui/status-colors";
import type { StatusColor } from "@/lib/ui/status-colors";

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
  gender = "m",
  className,
}: {
  value: string;
  type: StatusBadgeType;
  gender?: Gender;
  className?: string;
}) {
  const color = getStatusColor(type, value);

  return (
    <Badge variant={VARIANT_BY_COLOR[color]} className={cn(className)}>
      {getStatusLabel(type, value, gender)}
    </Badge>
  );
}
