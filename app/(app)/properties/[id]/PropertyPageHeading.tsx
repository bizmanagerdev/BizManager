import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";

// The head of a property's page: one slim line — where you are, its name right
// after "נכסים", and the handful of things you can do to it (owner,
// 2026-10-22: "for sure remove the word דירה and פנוי and move the name up to
// right after נכסים"). What kind it is and whether it's rented are on its own
// card below. Shown at every width — a property has no phone header of its own.

export default function PropertyPageHeading({ name, actions }: { name: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <nav className="flex min-w-0 items-center gap-1.5" aria-label="ניווט">
        <Link href="/properties" className="shrink-0 text-sm text-muted-foreground hover:text-foreground hover:underline">
          נכסים
        </Link>
        <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 truncate text-lg font-bold tracking-tight">{name}</h1>
      </nav>
      {actions}
    </div>
  );
}
