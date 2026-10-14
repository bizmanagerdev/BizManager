import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";

// The desktop head of a customer page: where you are (לקוחות ‹ name) and the
// handful of things you can do to the customer — the order page's heading
// (OrderPageHeading.tsx). Its own component so the page and its loading screen
// (CustomerPageSkeleton) draw the same thing. Desktop only: on the phone the
// name is in the top bar and the actions in its ⋮, so a line here would only
// repeat them.

export default function CustomerPageHeading({ name, actions }: { name: ReactNode; actions?: ReactNode }) {
  return (
    <div className="hidden lg:block">
      <div className="flex items-start justify-between gap-3">
        <nav
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
          aria-label="ניווט"
        >
          <Link href="/customers" className="hover:text-foreground hover:underline">
            לקוחות
          </Link>
          <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0" />
          <h1 className="min-w-0 text-lg font-bold text-foreground">{name}</h1>
        </nav>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
