import AppShell from "@/components/layout/AppShell";
import { TableSkeleton, TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { TasksTabs } from "@/components/tasks/TasksTabs";
import { LIST_CARD_BODY, LIST_CARD_META, LIST_CARD_NAME } from "@/components/ui/list-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The recurring templates page's own shape (it used to get the board's
// placeholder from tasks/loading.tsx — a board, and a phone strip this page
// doesn't have): the section's tabs, the line with the "new" button, then the
// template cards on a phone and the templates table from md — the orders
// table's shell and density since 2026-10-11, with RecurringTasksClient's
// columns.
const COLUMNS = ["משימה קבועה", "מקושר ל", "דומיין", "יצירה", "יעד", "משויכים", "עדיפות", "סטטוס", "פעיל", "פעולות"];

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
          <div className="space-y-2 md:hidden">
            <p className="px-1 text-[0.647rem] text-muted-foreground">החלק כרטיס ימינה לעריכה ומחיקה</p>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/70 bg-card shadow-sm">
                {/* The card's own lines, in its own type: the name, the where
                    line, the pills. */}
                <div className={cn("space-y-2 text-sm", LIST_CARD_BODY)}>
                  <div className="space-y-0.5">
                    <TextLineSkeleton className={LIST_CARD_NAME} barClassName="w-1/2" />
                    <TextLineSkeleton className={LIST_CARD_META} barClassName="w-1/3" />
                  </div>
                  <div className="flex gap-1.5">
                    <Skeleton className="h-[calc(0.647rem*1.5+0.25rem+2px)] w-14 rounded-full" />
                    <Skeleton className="h-[calc(0.647rem*1.5+0.25rem+2px)] w-16 rounded-full" />
                  </div>
                  <div className="space-y-1">
                    {[0, 1, 2, 3].map((j) => (
                      <TextLineSkeleton key={j} className="text-xs" barClassName="w-28" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <TableSkeleton headers={COLUMNS} rows={6} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
