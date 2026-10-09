"use client";

import type { ReactNode } from "react";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A loading screen's phone strip (AppShell's #page-header-toolbar) for a page
 * that fills it: held open from the first paint like PageHeaderToolbarSpace,
 * and showing the shape of what the page will put there — by default its
 * search field, in the row every page's strip uses (centred, max-w-md) — so
 * the strip isn't a blank band until the page arrives. Only on a page that
 * WILL fill the strip.
 */
export function PageHeaderToolbarSkeleton({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <PageHeaderToolbar>
      <div className={cn("mx-auto flex w-full max-w-md items-center justify-center gap-2", className)} aria-hidden>
        {children ?? <Skeleton className="h-10 w-full rounded-xl" />}
      </div>
    </PageHeaderToolbar>
  );
}
