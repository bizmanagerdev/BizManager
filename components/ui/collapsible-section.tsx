"use client";

// A card whose body folds away.
//
// The project page stacks ~8 heavy blocks (summary, income, expenses, billing,
// details, reminders, activity, actions). Each collapses to a single line —
// title, its headline number, chevron — so the reader opens what they came for.
// Same behaviour on every width: what's worth opening differs per person, not
// per screen size. `defaultOpen` decides what greets you.

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  id,
  title,
  summary,
  icon,
  action,
  defaultOpen = false,
  openWhenEmptyKnown,
  collapsible = true,
  className,
  contentClassName,
  children,
}: {
  /** Anchor id. Linking to `#id` from elsewhere opens and scrolls to it. */
  id?: string;
  title: ReactNode;
  /** Headline value shown next to the title, e.g. the section total. */
  summary?: ReactNode;
  icon?: ReactNode;
  /** Buttons for the section — beside the title on desktop, above the body on mobile. */
  action?: ReactNode;
  defaultOpen?: boolean;
  /**
   * For sections whose count only arrives after a fetch: pass true once the data
   * says there IS something, and the section opens itself — unless the reader
   * has already toggled it, in which case their choice stands. An empty section
   * stays folded.
   */
  openWhenEmptyKnown?: boolean;
  /** false = always open, no chevron. For sections that have no reason to fold. */
  collapsible?: boolean;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  // null = the reader hasn't touched it, so the section follows the data:
  // openWhenEmptyKnown once a count has arrived, defaultOpen until then. The
  // moment they click, their choice wins and nothing overrides it.
  const [openState, setOpen] = useState<boolean | null>(null);
  const dataOpen = openWhenEmptyKnown ?? defaultOpen;
  const open = collapsible ? openState ?? dataOpen : true;
  const contentId = useId();

  const toggle = () => setOpen(!open);

  // A link to `#this-section` (e.g. the פעולות shortcut to תזכורות) should open
  // it, not just scroll to a closed header.
  useEffect(() => {
    if (!id) return;
    const openIfTargeted = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    openIfTargeted();
    window.addEventListener("hashchange", openIfTargeted);
    return () => window.removeEventListener("hashchange", openIfTargeted);
  }, [id]);

  return (
    <Card id={id} className={cn("scroll-mt-24", className)}>
      {/* Fixed header height: a section with a "+" button and one without it
          must read as the same row when both are closed. */}
      <CardHeader className="min-h-[3.75rem] flex-row items-center gap-2 space-y-0 px-4 py-2.5 lg:px-6">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          disabled={!collapsible}
          className="flex min-w-0 flex-1 items-center gap-2 text-start disabled:cursor-default"
        >
          {icon}
          {/* Wraps rather than truncates — a section header ending in "…" tells
              the reader nothing. */}
          <CardTitle className="text-base">{title}</CardTitle>
          {summary !== undefined && summary !== null ? (
            <span className="ms-auto shrink-0 text-sm font-medium">{summary}</span>
          ) : null}
        </button>
        {/* Outside the toggle button (no nested buttons): the section's own
            actions — typically a compact "+" — sit next to the total at every
            size, so adding never costs an extra tap to expand first. */}
        {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}

        {/* The chevron is last, i.e. hard against the left edge in RTL. */}
        {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={open ? "כיווץ" : "הרחבה"}
          className="shrink-0"
        >
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        ) : null}
      </CardHeader>

      {/* Visibility lives on the CardContent and the section's own layout classes
          on an inner box — merging them would let a `flex` from the caller win
          over the `hidden` that keeps the section collapsed. */}
      <CardContent
        id={contentId}
        className={cn(open ? null : "hidden", "px-4 pb-4 pt-0 lg:px-6 lg:pb-6")}
      >
        <div className={contentClassName}>{children}</div>
      </CardContent>
    </Card>
  );
}
