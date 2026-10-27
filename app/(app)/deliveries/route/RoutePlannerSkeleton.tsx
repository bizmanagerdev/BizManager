import { Skeleton } from "@/components/ui/skeleton";

/** The planner's shape while it loads: the step bar, the map and the step on a phone; the steps beside the map on a computer. */
export default function RoutePlannerSkeleton() {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="space-y-5">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-64 rounded-card lg:hidden" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-10 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="hidden h-[calc(100dvh-7rem)] min-h-[420px] rounded-card lg:block" />
    </div>
  );
}
