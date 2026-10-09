import type { ReactNode } from "react";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The checks register before its data, from ChecksClient's own pieces: the
// four summary cards (2-up from sm, 4-up from xl) with their names, the filter
// row — its buttons ("טרם נפרעו" open), the sort and the search — then the
// table from sm and the check cards below it. For the route's loading screen.

const FILTERS = ["טרם נפרעו", "הכל", "להפקדה היום", "השבוע", "באיחור", "עתידי", "נפרעו"];
const COLUMNS: { label: string; center?: boolean }[] = [
  { label: "לקוח" },
  { label: "מס׳ צ׳ק" },
  { label: "סכום", center: true },
  { label: "תאריך פירעון" },
  { label: "סטטוס" },
  { label: "מקור" },
  { label: "צילום", center: true },
  { label: "פעולות", center: true },
];

// A number inside a line of words (a count, an amount), not known yet.
const INLINE = <Skeleton className="inline-block h-[0.75em] w-6 align-middle" />;

function SummaryCardSkeleton({ label }: { label: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <TextLineSkeleton className="mt-1 text-lg font-semibold" barClassName="w-24" />
    </div>
  );
}

// A check's status badge (Badge: rounded-full px-2.5 py-1 text-xs).
const BADGE = <Skeleton className="h-[1.625rem] w-16 rounded-full" />;

export default function ChecksSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCardSkeleton label={<>לפירעון ({INLINE})</>} />
        <SummaryCardSkeleton label="להפקדה השבוע" />
        <SummaryCardSkeleton label="באיחור להפקדה" />
        <SummaryCardSkeleton label="נפרעו" />
      </div>

      {/* The filter buttons, then the sort and the search — each a full line
          where the page's own are (the select is full-width). */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((label, i) => (
          <span key={label} className={buttonVariants({ size: "sm", variant: i === 0 ? "default" : "outline" })}>
            {label}
          </span>
        ))}
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-xl sm:w-64" />
      </div>

      <div className="hidden max-h-[70vh] overflow-hidden rounded-2xl border border-border/70 sm:block">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="bg-muted">
            <tr className="border-b border-border/70 text-xs text-muted-foreground">
              {COLUMNS.map(({ label, center }) => (
                <th key={label} className={cn("px-3 py-2 font-medium", center ? "text-center" : "text-right")}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="px-3 py-2">
                  <TextLineSkeleton className="text-sm" barClassName="w-28" />
                  <TextLineSkeleton className="text-xs" barClassName="w-20" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-3 w-14" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="mx-auto h-4 w-16" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-3.5 w-20" />
                </td>
                <td className="px-3 py-2">{BADGE}</td>
                <td className="px-3 py-2">
                  <Skeleton className="h-3 w-20" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="mx-auto h-3 w-8" />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <Skeleton className="h-8 w-20 rounded-xl" />
                    <Skeleton className="h-9 w-9 rounded-xl" />
                    <Skeleton className="h-9 w-9 rounded-xl" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: the check cards — customer and amount, the details line, the actions. */}
      <div className="space-y-3 sm:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/70 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <TextLineSkeleton barClassName="w-32" />
                <TextLineSkeleton className="text-xs" barClassName="w-24" />
              </div>
              <TextLineSkeleton className="shrink-0 text-lg font-semibold" barClassName="w-16" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {BADGE}
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="mt-2 border-t border-border/50 pt-2">
              <div className="flex items-center justify-center gap-1">
                <Skeleton className="h-8 w-20 rounded-xl" />
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="h-9 w-9 rounded-xl" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
