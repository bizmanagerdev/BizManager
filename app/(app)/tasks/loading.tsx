import AppShell from "@/components/layout/AppShell";
import TasksBoardSkeleton from "./TasksBoardSkeleton";
import { PageHeaderToolbarSpace } from "@/components/layout/PageHeaderToolbar";

// Streamed instantly while the board's data loads, so TTFB = time-to-shell.
export default function TasksLoading() {
  return (
    <AppShell>
      {/* The board's search / filter row: its strip held open on a phone, so
          the board arriving doesn't push everything down. */}
      <PageHeaderToolbarSpace />
      <div className="space-y-4" data-route-loading="true">
        <TasksBoardSkeleton />
      </div>
    </AppShell>
  );
}
