import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";

// The head of a property's page, the same shape as a project's or an order's
// (owner, 2026-10-20): where you are, what this is, and the handful of things
// you can do to it. Shown at every width — a property has no phone header of
// its own.

export default function PropertyPageHeading({
  name,
  typeLabel,
  rented,
  inactive,
  actions,
}: {
  name: string;
  typeLabel: string | null;
  /** Has an active lease. */
  rented: boolean;
  inactive: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="ניווט">
          <Link href="/properties" className="hover:text-foreground hover:underline">
            נכסים
          </Link>
          <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="text-foreground">{typeLabel || "נכס"}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight">{name}</h1>
          {inactive ? (
            <Badge variant="neutral">לא פעיל</Badge>
          ) : (
            <Badge variant={rented ? "success" : "outline"}>{rented ? "מושכר" : "פנוי"}</Badge>
          )}
        </div>
      </div>
      {actions}
    </div>
  );
}
