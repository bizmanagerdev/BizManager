import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { PageHeaderToolbarSkeleton } from "@/components/layout/PageHeaderToolbarSkeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FilterIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The activity page's placeholder, from ActivityClient's own pieces: the
// users card (a list of people on a phone, a row of pills from md), the md+
// filter row, then the feed — the table from md, the cards below it. Shown
// while the page streams (loading.tsx) and while the client's code loads (the
// dynamic() fallback).

const COLUMNS = ["פעולה", "רשומה", "משתמש", "פרטים", "לפני", "זמן"];

// The "live" dot, as the page draws it beside "עדכון חי".
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="relative inline-flex h-2 w-2 rounded-full bg-success-soft-foreground" />
    </span>
  );
}

/** The phone strip: the live indicator and the "סינון" button, as the page puts them there. */
export function ActivityStripSkeleton() {
  return (
    <PageHeaderToolbarSkeleton className="justify-between">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <LiveDot />
        עדכון חי
      </span>
      <span className={cn(buttonVariants(), "h-10 shrink-0 gap-1.5 rounded-xl px-3")}>
        <FilterIcon className="h-4 w-4" />
        <span className="text-xs">סינון</span>
      </span>
    </PageHeaderToolbarSkeleton>
  );
}

// An action badge (rounded px-2 py-0.5 text-xs) whose words aren't known yet.
const BADGE = <Skeleton className="h-5 w-14 rounded" />;

// The actor: their avatar (h-6) and name.
function ActorSkeleton() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Skeleton className="h-6 w-6 rounded-full" />
      <Skeleton className="h-3 w-16" />
    </span>
  );
}

export default function ActivitySkeleton() {
  return (
    <div className="space-y-4 text-right" dir="rtl" aria-busy="true">
      {/* OnlineUsersCard */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="relative flex h-2.5 w-2.5">
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success-soft-foreground" />
            </span>
            <span className="text-sm font-medium">פעילות משתמשים</span>
            <TextLineSkeleton className="text-xs" barClassName="w-36" />
          </div>
          <div className="md:hidden">
            <div className="divide-y divide-border/40">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 py-1.5">
                  <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <TextLineSkeleton className="text-sm" barClassName="w-28" />
                    <TextLineSkeleton className="text-xs" barClassName="w-20" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card py-1 pe-2.5 ps-1"
              >
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <Skeleton className="h-3 w-24" />
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* The md+ filter row: type / action / user, the "users only" box, the live indicator. */}
      <div className="hidden md:flex md:items-center md:justify-between md:gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-36 rounded-lg" />
          ))}
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs shadow-sm">
            <span className="h-3.5 w-3.5 rounded-sm border border-input" />
            רק פעולות משתמשים
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <LiveDot />
          עדכון חי
        </span>
      </div>

      {/* md+: the feed's table, its own columns. */}
      <div className="hidden rounded-b-lg border border-border/60 bg-card shadow-sm md:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[6rem]" />
            <col className="w-[13rem]" />
            <col className="w-[11rem]" />
            <col />
            <col className="w-[9rem]" />
            <col className="w-[8.5rem]" />
          </colgroup>
          <thead>
            <tr className="border-b-2 border-border bg-[rgb(var(--secondary-10))] text-sm font-semibold text-foreground shadow-sm">
              {COLUMNS.map((column) => (
                <th key={column} className="whitespace-nowrap px-3 py-3.5 text-right">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2 align-middle">{BADGE}</td>
                <td className="px-3 py-2 align-middle">
                  <Skeleton className="h-4 w-4/5" />
                </td>
                <td className="px-3 py-2 align-middle text-xs">
                  <ActorSkeleton />
                </td>
                <td className="px-3 py-2 align-middle">
                  <Skeleton className="h-3 w-3/4" />
                </td>
                <td className="px-3 py-2 align-middle">
                  <Skeleton className="h-3 w-1/2" />
                </td>
                <td className="px-3 py-2 align-middle">
                  <Skeleton className="h-3 w-20" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: the feed's cards — badge and time, record, actor, details. */}
      <div className="space-y-1.5 md:hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="py-2 px-4">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  {BADGE}
                  <Skeleton className="h-3 w-16" />
                </div>
                <TextLineSkeleton className="text-sm leading-tight" barClassName="w-3/4" />
                <div className="text-xs">
                  <ActorSkeleton />
                </div>
                <TextLineSkeleton className="text-xs leading-tight" barClassName="w-1/2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
