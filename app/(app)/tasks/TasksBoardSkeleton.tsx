import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The board's placeholder: the Trello-style status columns, to keep the
// placeholder → board swap calm. Shown while the page streams (loading.tsx)
// and while the device version works the board out (LocalTasksBoard).
export default function TasksBoardSkeleton() {
  return (
    <>
      {/* Flush with the top like the board itself (TasksPageClient's -mt-*
          cancels the page's padding) — or the board, arriving, jumps up by it. */}
      <div className="-mt-4 flex gap-2 md:-mt-6 lg:-mt-8">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="space-y-3">
            <Skeleton className="h-6 w-24" />
            {Array.from({ length: 3 }).map((_, c) => (
              <Card key={c} className="p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </Card>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
