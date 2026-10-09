import AppShell from "@/components/layout/AppShell";
import ProjectExportSkeleton from "./ProjectExportSkeleton";

// Streamed instantly while the work sheet's data (the project, its customer,
// tasks, team and files) loads, so TTFB = time-to-shell. The sheet's own shape
// (ProjectExportSkeleton) instead of the project page's placeholder it used
// to inherit — a page it doesn't look like.
export default function ProjectExportLoading() {
  return (
    <AppShell>
      <div data-route-loading="true">
        <ProjectExportSkeleton />
      </div>
    </AppShell>
  );
}
