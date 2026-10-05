import AppShell from "@/components/layout/AppShell";
import ProjectPageLoading from "@/app/(app)/projects/[id]/ProjectPageLoading";

// Streamed instantly while this project's data loads (six parallel read
// chains keyed off the id), so TTFB = time-to-shell, not time-to-all-queries.
// Opened from the projects list, it already carries the project's header.
export default function ProjectDetailLoading() {
  return (
    <AppShell>
      <ProjectPageLoading />
    </AppShell>
  );
}
