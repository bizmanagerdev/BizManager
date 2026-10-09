import { cn } from "@/lib/utils";

/**
 * The app's one count badge — the sales tabs' small round pill (owner,
 * 2026-10-09: "the order style everywhere, mobile and desktop"): dark on the
 * selected tab or chip, grey on the others. Every count on a tab, a filter
 * chip or a list header uses it, so a count looks the same wherever it is.
 */
export function CountBadge({ count, active = false, className }: { count: number; active?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4 tabular-nums",
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        className
      )}
    >
      {count}
    </span>
  );
}
