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
        // 0.647rem: one of the app's two small sizes (with text-xs) — it was
        // 0.588rem, one of six near-duplicates (owner, 2026-10-11).
        "inline-flex min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[0.647rem] font-semibold leading-4 tabular-nums",
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        className
      )}
    >
      {count}
    </span>
  );
}
