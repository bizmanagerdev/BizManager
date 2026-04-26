import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { getStatusColor, getStatusLabel, type StatusBadgeType } from "@/lib/ui/status-colors";

export function StatusBadge({
  value,
  type,
  className,
}: {
  value: string;
  type: StatusBadgeType;
  className?: string;
}) {
  const color = getStatusColor(type, value);

  return (
    <Badge className={cn(getStatusColorClasses(color), className)}>
      {getStatusLabel(type, value)}
    </Badge>
  );
}
