import { buttonVariants } from "@/components/ui/button";
import { PhoneIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

// The communications log before its data, from CommunicationsClient's own
// pieces: the toolbar ("תיעוד שיחה", the topic and channel selects — each a
// full line, as the page's are — the search and the count), then the log's
// grid rows with their column names, scrolling sideways on a phone as the
// page's do. For the route's loading screen.

// CommunicationsClient's column template, so the rows line up as the page's do.
const GRID = "grid grid-cols-[1.5rem_minmax(9rem,1.4fr)_7rem_4.5rem_minmax(0,3fr)_9rem_2rem] items-center gap-x-3";

export default function CommunicationsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap items-center gap-2">
        <span className={buttonVariants({ size: "sm", variant: "outline" })}>
          <PhoneIcon className="h-4 w-4 text-success" />
          תיעוד שיחה
        </span>
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-10 max-w-xs flex-1 rounded-xl" />
        <div className="text-sm text-muted-foreground">
          <Skeleton className="inline-block h-[0.75em] w-6 align-middle" /> פניות
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[54rem] space-y-1">
          <div className={`${GRID} px-2.5 pb-1 text-xs text-muted-foreground`}>
            <span />
            <span>לקוח</span>
            <span>טלפון</span>
            <span>נושא</span>
            <span>תוכן</span>
            <span>תאריך</span>
            <span />
          </div>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={`${GRID} rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 text-sm`}>
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-9 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
