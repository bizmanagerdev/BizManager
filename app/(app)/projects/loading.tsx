import AppShell from "@/components/layout/AppShell";
import ProjectsLoadingBody from "@/app/(app)/projects/ProjectsLoadingBody";
import ProjectsListSkeleton from "@/app/(app)/projects/ProjectsListSkeleton";

// Streamed instantly while the page's data loads, so TTFB = time-to-shell.
// The list's own shape (ProjectsListSkeleton) to keep the swap shift-free — on
// the way to a project's page, that page's own loading screen instead
// (ProjectsLoadingBody).
export default function ProjectsLoading() {
  return (
    <AppShell>
      <ProjectsLoadingBody
        list={
          <div className="space-y-4" data-route-loading="true">
            <ProjectsListSkeleton />
          </div>
        }
      />
    </AppShell>
  );
}
