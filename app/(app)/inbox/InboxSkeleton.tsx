import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { buttonVariants } from "@/components/ui/button";
import { SettingsIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The inbox before its data, from InboxClient's own pieces: the heading and
// its count line, the page's buttons, the category chips, then a day's group
// of reminder cards (the tile, the title and text, the time and the actions),
// and the history link at the foot. For the inbox's loading screen — and
// /alerts', which lands here.

const GHOST = cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground");

function CardSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3">
      <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <TextLineSkeleton className="text-sm font-semibold" barClassName="w-3/4" />
        <TextLineSkeleton className="mt-0.5 text-xs" barClassName="w-1/2" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <TextLineSkeleton className="text-[11px]" barClassName="w-28" />
          <span className="flex items-center gap-0.5">
            <Skeleton className="h-6 w-14 rounded-lg" />
            <Skeleton className="h-7 w-7" />
            <Skeleton className="h-7 w-7" />
          </span>
        </div>
      </div>
    </div>
  );
}

export default function InboxSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">התראות</h1>
          <TextLineSkeleton className="text-xs" barClassName="w-24" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={GHOST}>
            <SettingsIcon className="h-4 w-4" />
            העדפות
          </span>
          <span className={GHOST}>רענן</span>
        </div>
      </div>

      {/* The category chips (rounded-full px-3 py-1 text-xs, a count in each). */}
      <div className="flex flex-wrap items-center gap-1.5">
        {["w-16", "w-20", "w-24"].map((width) => (
          <Skeleton key={width} className={cn("h-[1.625rem] rounded-full", width)} />
        ))}
      </div>

      <section className="space-y-2">
        <TextLineSkeleton className="text-xs font-medium" barClassName="w-12" />
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </section>

      <div className="pt-1 text-center">
        <span className="text-xs text-muted-foreground">היסטוריית התראות שנשלחו</span>
      </div>
    </div>
  );
}
