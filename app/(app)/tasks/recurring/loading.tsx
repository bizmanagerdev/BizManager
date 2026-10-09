import AppShell from "@/components/layout/AppShell";
import { TasksTabs } from "@/components/tasks/TasksTabs";
import { Skeleton } from "@/components/ui/skeleton";

// The recurring templates page's own shape (it used to get the board's
// placeholder from tasks/loading.tsx — a board, and a phone strip this page
// doesn't have): the section's tabs, the line with the "new" button, the
// template cards.
export default function RecurringTasksLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <TasksTabs />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-10 w-36 rounded-xl" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="mt-2 h-4 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
