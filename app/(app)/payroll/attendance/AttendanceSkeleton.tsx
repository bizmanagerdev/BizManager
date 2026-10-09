import { PageHeaderToolbarSkeleton } from "@/components/layout/PageHeaderToolbarSkeleton";
import { ApprovedUserIcon, ClockIcon, CoinsIcon, PendingIcon, type IconComponent } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

// The attendance queue before its data, from AttendanceQueuePanel's own
// classes: on a phone the header strip it fills (the worker filter and the
// guide button), the summary band — its four chips with their names, and from
// md the filter and guide button under them — then the "waiting for approval"
// list of report cards (PendingReportCard's frame: who / when, the שיוך
// select, the glyphs and "אישור"). Shown while the page streams (loading.tsx,
// and payroll's own loading screen on the way here — PayrollLoadingBody).

/** The phone strip's worker filter and "מדריך" button, as the queue puts them there. */
export function AttendanceStripSkeleton() {
  return (
    <PageHeaderToolbarSkeleton>
      <Skeleton className="h-10 w-full min-w-0 max-w-[13rem] rounded-xl" />
      <Skeleton className="h-10 w-20 shrink-0 rounded-xl" />
    </PageHeaderToolbarSkeleton>
  );
}

// The chips as an admin sees them while reports wait (the fourth is the
// pending cost; office, or an empty queue, gets "עובדים בתור" there).
const STATS: { icon: IconComponent; label: string }[] = [
  { icon: PendingIcon, label: "ממתינים לאישור" },
  { icon: ApprovedUserIcon, label: "נוכחים כעת" },
  { icon: ClockIcon, label: "שעות ממתינות" },
  { icon: CoinsIcon, label: "עלות שכר ממתינה" },
];

/** A bare glyph button: h-8, 44px square on a phone. */
function GlyphSkeleton() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center max-md:min-h-[44px] max-md:min-w-[44px]">
      <Skeleton className="h-4 w-4" />
    </span>
  );
}

function ReportCardSkeleton() {
  return (
    <div className="rounded-xl border-2 border-border bg-card px-3 py-2 shadow-sm">
      {/* WorkerHead: name, phone, the shift's hours stacked, the date; the note; the cost. */}
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm">
              <Skeleton className="inline-block h-3.5 w-24 align-middle" />
            </span>
            <span className="text-xs">
              <Skeleton className="inline-block h-2.5 w-20 align-middle" />
            </span>
            <span className="ms-auto shrink-0 text-end leading-tight">
              <span className="block text-xs">
                <Skeleton className="inline-block h-2.5 w-14 align-middle" />
              </span>
              <span className="block text-[11px]">
                <Skeleton className="inline-block h-2 w-20 align-middle" />
              </span>
            </span>
            <span className="text-xs">
              <Skeleton className="inline-block h-2.5 w-16 align-middle" />
            </span>
          </div>
          <div className="text-xs">
            <Skeleton className="inline-block h-2.5 w-2/3 align-middle" />
          </div>
        </div>
        <Skeleton className="h-6 w-14 shrink-0 rounded-full" />
      </div>
      <div className="relative mt-2 border-t border-border/60 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-full min-w-[8.5rem] max-w-40 rounded-xl" />
        </div>
        <div className="mt-2 flex items-center justify-end gap-1">
          <GlyphSkeleton />
          <GlyphSkeleton />
          <GlyphSkeleton />
          <Skeleton className="h-8 w-16 shrink-0 rounded-xl max-md:h-[44px]" />
        </div>
      </div>
    </div>
  );
}

export default function AttendanceSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="space-y-2 rounded-2xl border border-secondary/25 bg-secondary/5 px-3 py-3 sm:px-4">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {STATS.map(({ icon: Icon, label }) => (
            <div key={label} className="rounded-xl border bg-background px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <div className="ps-5 text-base font-bold">
                <Skeleton className="inline-block h-4 w-10 align-middle" />
              </div>
            </div>
          ))}
        </div>
        {/* md+: the worker filter and "מדריך לעובדים" (on a phone they're in the strip). */}
        <div className="hidden items-center gap-2 md:flex">
          <Skeleton className="h-9 w-44 rounded-lg" />
          <Skeleton className="h-9 w-36 rounded-xl" />
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-warning" />
          ממתינים לאישור
          <Skeleton className="h-3 w-6" />
        </h3>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ReportCardSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
