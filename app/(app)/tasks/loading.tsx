import AppShell from "@/components/layout/AppShell";
import TasksBoardSkeleton from "./TasksBoardSkeleton";

// Streamed instantly while the board's data loads, so TTFB = time-to-shell.
export default function TasksLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <TasksBoardSkeleton />
      </div>
    </AppShell>
  );
}
