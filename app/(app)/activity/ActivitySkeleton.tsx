import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { PageHeaderToolbarSkeleton } from "@/components/layout/PageHeaderToolbarSkeleton";
import { buttonVariants } from "@/components/ui/button";
import { FilterIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The activity page's placeholder, drawn from its own pieces, so nothing moves
// when the page arrives: "היום בעסק" (its four numbers and the hours chart),
// "מי עובד עכשיו" (a row of people), the wide-screen search row, then today's
// heading and the feed's entries (icon, sentence, who, time). Shown while the
// page streams (loading.tsx) and while the client's code loads (dynamic()).

/** The phone strip: the search field and the filter button, as the page puts them there. */
export function ActivityStripSkeleton() {
  return (
    <PageHeaderToolbarSkeleton>
      <Skeleton className="h-10 min-w-0 flex-1 rounded-xl" />
      <span className={cn(buttonVariants(), "h-10 w-10 shrink-0 rounded-xl p-0")}>
        <FilterIcon className="h-4 w-4" />
      </span>
    </PageHeaderToolbarSkeleton>
  );
}

function TileSkeleton() {
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5 rounded-xl border border-border/60 bg-background p-2.5">
      <span className="flex w-full items-start gap-1.5 text-xs leading-tight">
        <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
        <Skeleton className="h-[0.75em] w-16" />
      </span>
      <TextLineSkeleton className="text-lg leading-tight sm:text-xl" barClassName="w-20" />
      <TextLineSkeleton className="w-full text-[0.647rem] leading-snug" barClassName="w-24" />
    </div>
  );
}

export default function ActivitySkeleton() {
  return (
    <div className="space-y-4 text-right" dir="rtl" aria-busy="true">
      {/* היום בעסק */}
      <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm sm:p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">היום בעסק</h2>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
            מתחבר…
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
        <div className="mt-3">
          <div className="flex h-14 items-end gap-[3px]">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <Skeleton className="w-full rounded-b-none rounded-t-[3px]" style={{ height: `${20 + ((i * 37) % 60)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 text-[0.588rem]">&nbsp;</div>
          <TextLineSkeleton className="mt-1 text-xs" barClassName="w-48" />
        </div>
      </section>

      {/* מי עובד עכשיו */}
      <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm sm:p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h2 className="text-base font-semibold text-foreground">מי עובד עכשיו</h2>
          <TextLineSkeleton className="text-xs" barClassName="w-32" />
        </div>
        <div className="-mx-1 flex gap-1 overflow-hidden px-1 pb-1 md:flex-wrap">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex w-[4.75rem] shrink-0 flex-col items-center gap-0.5 px-1 py-1.5">
              <Skeleton className="h-9 w-9 rounded-full" />
              <TextLineSkeleton className="text-xs leading-tight" barClassName="w-12" />
              <TextLineSkeleton className="text-[0.588rem] leading-tight" barClassName="w-10" />
            </div>
          ))}
        </div>
      </section>

      {/* Wide screens: search, three dropdowns and the chip. */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <Skeleton className="h-10 w-full max-w-xs rounded-xl" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-36 rounded-lg" />
        ))}
        <Skeleton className="h-[34px] w-44 rounded-lg" />
      </div>

      {/* Today's entries: the day's table where there's room (as ActivityFeed,
          by the width measured in the text's own size)… */}
      <div className="@container">
        <section className="hidden overflow-clip rounded-xl border border-border/60 bg-card shadow-sm md:@min-[44rem]:block">
          <table className="w-full table-fixed border-separate border-spacing-0 text-start">
            <colgroup>
              <col className="w-[3.25rem]" />
              <col />
              <col className="w-[32%]" />
              <col className="w-[9rem]" />
              <col className="w-[4.5rem]" />
            </colgroup>
            <thead>
              <tr>
                <th colSpan={5} className="bg-card px-3 pb-2 pt-2.5 text-start">
                  <span className="text-sm font-semibold text-foreground">היום</span>
                </th>
              </tr>
              <tr className="bg-[rgb(var(--secondary-10))] text-xs font-semibold text-foreground/80 [&>th]:border-y [&>th]:border-border/60 [&>th]:py-2">
                <th className="ps-3" />
                <th className="px-2 text-start">מה קרה</th>
                <th className="px-2 text-start">פרטים ושינויים</th>
                <th className="px-2 text-start">מי</th>
                <th className="pe-3 ps-2 text-start">שעה</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="align-top [&>td]:border-t [&>td]:border-border/50">
                  <td className="py-2 pe-1 ps-3">
                    <Skeleton className="mt-px h-7 w-7 rounded-full" />
                  </td>
                  <td className="px-2 py-2">
                    <TextLineSkeleton className="text-sm leading-snug" barClassName={i % 2 ? "w-3/5" : "w-4/5"} />
                  </td>
                  <td className="px-2 py-2 text-xs">
                    <TextLineSkeleton barClassName="w-1/2" />
                  </td>
                  <td className="px-2 py-2 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
                      <Skeleton className="h-[0.75em] w-16" />
                    </span>
                  </td>
                  <td className="py-2 pe-3 ps-2 text-xs">
                    <TextLineSkeleton barClassName="w-9" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* …and the phone's list under its heading. */}
        <section className="md:@min-[44rem]:hidden">
          <h2 className="-mx-1 flex items-baseline gap-2 px-1 py-1.5 text-sm font-semibold text-foreground">
            היום
            <TextLineSkeleton className="text-xs font-normal" barClassName="w-14" />
          </h2>
          <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex gap-3 px-3 py-2.5 sm:px-4">
                <Skeleton className="mt-0.5 h-9 w-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <TextLineSkeleton className="min-w-0 flex-1 text-sm leading-snug" barClassName={i % 2 ? "w-3/5" : "w-4/5"} />
                    <Skeleton className="mt-1 h-3 w-9 shrink-0" />
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs">
                    <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
                    <Skeleton className="h-[0.75em] w-24" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
