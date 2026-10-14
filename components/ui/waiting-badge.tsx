import { SyncIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * "ממתין לשליחה" on a row saved with no connection: it's on the page at once,
 * and this says it hasn't reached the server yet (the red bar lists every
 * such save — components/layout/PendingSyncPanel.tsx). A quiet grey pill, so
 * it reads as a state, not an error.
 */
export function WaitingBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="neutral"
      className={cn("gap-1 px-2 py-0.5", className)}
      title="נשמר במכשיר — יישלח כשהחיבור יחזור"
    >
      <SyncIcon className="h-3 w-3" aria-hidden />
      ממתין לשליחה
    </Badge>
  );
}

export default WaitingBadge;
