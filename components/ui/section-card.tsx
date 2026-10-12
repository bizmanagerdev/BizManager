import type React from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A section header's icon, on every page: a plain grey glyph, the dashboard's
 * (owner, 2026-10-11: section icons grey everywhere, "like the dashboard" — the
 * order and project pages drew theirs navy). Pass it to SectionCard's and
 * CollapsibleSection's `icon`.
 */
export const SECTION_ICON_CLASS = "h-4 w-4 shrink-0 text-muted-foreground";

/**
 * A section header's count, on every page: the dashboard cards' grey pill
 * (owner, 2026-10-11: one look for a section's count — it was a grey pill on
 * the dashboard, outlined "N פריטים" pills on the order page and plain grey
 * "N קבצים" on the project page). Tabs and filter chips keep the smaller
 * CountBadge.
 */
export function SectionCount({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground",
        className
      )}
    >
      {count}
    </span>
  );
}

/**
 * The standard detail-page card: an icon + title on the header line, an optional
 * aside (count badge, "+" trigger) opposite it, and the section's body below.
 * Shared so every entity page's sections keep the same shell.
 *
 * The same box as CollapsibleSection, the project page's sections — the Card,
 * its corner and shadow, the header's height and the title's size — only never
 * folded (owner, 2026-10-11: "make the order page and the project page match
 * the section boxes"). It used to be a box of its own: rounder, see-through,
 * a lighter shadow and a smaller title.
 */
export function SectionCard({
  id,
  icon,
  title,
  aside,
  className,
  children,
}: {
  id?: string;
  icon: React.ReactNode;
  /** Text, or text with a placeholder bar in it (a loading screen's title). */
  title: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className={cn("scroll-mt-24", className)}>
      {/* Wraps: the aside (a count, a "+" button) drops under the title rather
          than running off a phone's edge at a bigger text size. */}
      <CardHeader className="min-h-[3.75rem] flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-4 py-2.5 lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          {/* CardTitle's look, kept an h2 — the page's section headings. */}
          <h2 className="text-base font-semibold leading-none tracking-tight text-balance">{title}</h2>
        </div>
        {aside}
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 pt-0 lg:px-6 lg:pb-6">{children}</CardContent>
    </Card>
  );
}

export default SectionCard;
