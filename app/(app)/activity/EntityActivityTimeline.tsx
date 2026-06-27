import { formatShortDateTime } from "@/lib/date";
import type { AuditFeedItem } from "@/lib/audit";

// Colored dot per action, matching the activity feed's badge palette.
function dotClass(action: string) {
  const a = action.toLowerCase();
  if (a.startsWith("morning")) return "bg-warning-soft-foreground";
  switch (a) {
    case "create":
    case "insert":
    case "login":
      return "bg-success-soft-foreground";
    case "update":
    case "status_changed":
      return "bg-info-soft-foreground";
    case "priority_changed":
      return "bg-warning-soft-foreground";
    case "delete":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}

/**
 * Compact, server-rendered "what happened to this entity" timeline. Pass the
 * rows from getEntityAuditTrail. Renders nothing when there's no history.
 */
export default function EntityActivityTimeline({ items }: { items: AuditFeedItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">אין פעילות מתועדת.</p>;
  }

  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <span className="relative mt-1.5 flex flex-col items-center">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(item.action)}`} />
          </span>
          <div className="min-w-0 flex-1 border-b border-border/40 pb-3 last:border-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm">
                <span className="font-medium">{item.actionLabel}</span>
                {item.entityLabel ? (
                  <span className="text-muted-foreground">{` · ${item.entityLabel}`}</span>
                ) : null}
              </span>
              <time className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                {formatShortDateTime(item.createdAt, "-")}
              </time>
            </div>
            {item.details ? (
              <div className="mt-0.5 text-xs text-foreground/70">{item.details}</div>
            ) : null}
            <div className="mt-0.5 text-[11px] text-muted-foreground">{item.actorName}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
