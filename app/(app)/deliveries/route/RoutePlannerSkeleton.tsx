import { Skeleton } from "@/components/ui/skeleton";

/** The planner's shape while it loads: the map, and the settings beside it on a computer. */
export default function RoutePlannerSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)] lg:items-start">
      <Skeleton className="h-72 rounded-card sm:h-96 lg:col-start-2 lg:row-start-1 lg:h-[520px]" />
      <div className="space-y-4 lg:col-start-1 lg:row-start-1">
        <Skeleton className="h-80 rounded-card" />
        <Skeleton className="h-44 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
      </div>
    </div>
  );
}
