"use client";

import Link from "next/link";
import { AddIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Small pieces every section of the customer page shares, so the "+" buttons,
// the counts still on their way and the placeholder rows look the same in
// every section — and in the loading screen (CustomerPageSkeleton).

/** Anchors of the page's sections — the ⋮ and the cards jump to them. */
export const SECTION_IDS = {
  orders: "customer-orders",
  projects: "customer-projects",
  // The name the גבייה page links to (CollectionsClient: /customers/<id>#collection-tracking).
  collection: "collection-tracking",
  tasks: "customer-tasks",
  payments: "customer-payments",
  promises: "customer-promises",
  contacts: "customer-contacts",
  documents: "customer-documents",
  notes: "customer-notes",
  morning: "customer-morning",
  leases: "customer-leases",
  history: "customer-history",
} as const;

/**
 * Open a section and scroll to it — CollapsibleSection opens itself when the
 * address points at it. The same address twice fires nothing, so it steps off
 * it first (without a history entry).
 */
export function openSection(id: string) {
  if (typeof window === "undefined") return;
  if (window.location.hash === `#${id}`) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
  window.location.hash = id;
}

// 32px to look at, 40 to tap: the ::before reaches past the button.
const ADD_BUTTON_CLASS = "relative h-8 gap-1 px-2.5 before:absolute before:-inset-1 before:content-['']";

/**
 * A section's "+" — the soft style (dashed sky outline), the same size in
 * every section (owner, 2026-10-13: "+ הזמנה" was a bold filled button beside
 * soft "+ פרויקט" / "+ משימה").
 */
export function AddActionButton({
  label,
  ariaLabel,
  href,
  onClick,
  disabled,
  title,
}: {
  label: string;
  /** What the "+" adds, in full ("הוספת איש קשר") — the label alone is one word. */
  ariaLabel?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  if (href) {
    return (
      <Button asChild size="sm" variant="soft" className={ADD_BUTTON_CLASS}>
        <Link href={href} aria-label={ariaLabel} title={title ?? ariaLabel}>
          <AddIcon aria-hidden />
          {label}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="soft"
      className={ADD_BUTTON_CLASS}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
    >
      <AddIcon aria-hidden />
      {label}
    </Button>
  );
}

/**
 * A blank the size of a short value, inside a line of text (a span: it sits in
 * a header's button or a card's row, where a div can't go).
 */
export function InlineSkeleton({ className }: { className?: string }) {
  return <span aria-hidden className={`inline-block animate-pulse rounded-md bg-muted align-middle ${className ?? "h-3 w-16"}`} />;
}

/** A section count still on its way: the grey pill's own size, blank. */
export function CountSkeleton() {
  return <InlineSkeleton className="h-5 w-7 rounded-full" />;
}

/** List rows still on their way (a title line and a line under it; the amount at the end). */
export function RowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="divide-y divide-border/60" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex h-[3.25rem] items-center justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </div>
          <Skeleton className="h-4 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}
