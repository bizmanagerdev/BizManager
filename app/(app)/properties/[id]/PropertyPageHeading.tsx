import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { TopBarHeading } from "@/components/layout/TopBarHeading";

// The head of a property's page: where you are, its name right after "נכסים",
// and the handful of things you can do to it (owner, 2026-10-22: "for sure
// remove the word דירה and פנוי and move the name up to right after נכסים").
// On a computer it's in the top bar ("the edit button and the three dots
// button up, and then we could move the whole page up higher";
// TopBarHeading); on the phone, which has no header of the property's own,
// it's the page's slim first line. What kind it is is on its card below.

export default function PropertyPageHeading({
  name,
  actions,
  phoneActions,
}: {
  name: string;
  /** Its edit and ⋮ on a computer — in the bar. */
  actions?: ReactNode;
  /** On the phone's line — the same buttons when not given (drawn twice: one copy can't be in two places). */
  phoneActions?: ReactNode;
}) {
  return (
    <>
      <TopBarHeading section="נכסים" href="/properties" title={<span className="min-w-0 truncate">{name}</span>} actions={actions} />
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <nav className="flex min-w-0 items-center gap-1.5" aria-label="ניווט">
          <Link href="/properties" className="shrink-0 text-sm text-muted-foreground hover:text-foreground hover:underline">
            נכסים
          </Link>
          <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className="min-w-0 truncate text-lg font-bold tracking-tight">{name}</h1>
        </nav>
        {phoneActions ?? actions}
      </div>
    </>
  );
}
