import { MatchReason } from "@/components/search/highlightMatch";
import type { GlobalSearchReason } from "@/lib/global-search";
import { cn } from "@/lib/utils";

/**
 * Under a list row (an order, a project) that a search found: why it came up —
 * "תשלום: ₪1,447", "תגובה במשימה: …", "שעת מסירה: 14:30" — the match painted
 * yellow, so a row found by something not on its card says what it was.
 */
export function SearchMatchLine({
  reasons,
  terms,
  className,
}: {
  reasons: readonly GlobalSearchReason[] | undefined;
  terms: readonly string[];
  className?: string;
}) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <div className={cn("space-y-0.5 text-xs text-muted-foreground", className)}>
      {reasons.map((reason) => (
        <MatchReason
          key={`${reason.kind}:${reason.label}`}
          label={reason.label}
          value={reason.value}
          terms={terms}
          whole={reason.kind !== "text"}
        />
      ))}
    </div>
  );
}
