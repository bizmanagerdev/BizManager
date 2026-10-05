"use client";

import { useSetPageTitle } from "@/components/layout/page-title-context";
import ProjectMobileHeader from "@/app/(app)/projects/[id]/ProjectMobileHeader";
import ProjectPageHeading, { projectTypeLabel } from "@/app/(app)/projects/[id]/ProjectPageHeading";
import type { ProjectPreview } from "@/app/(app)/projects/[id]/projectPreview";
import { formatShortDate } from "@/lib/date";

// A project page before its data arrives: the real header — drawn by the same
// components as the page, from what the projects list knew — over grey blocks
// where the cards and movements will be. Laid out like the page (same stack,
// same gaps), so when the page lands the header doesn't move and the blocks
// fill in. Rendered over the list the moment a row is tapped
// (ProjectOpeningOverlay) and as the page's loading screen (ProjectPageLoading).

function ActionsSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-9 w-20 animate-pulse rounded-md bg-muted/60" />
      ))}
    </div>
  );
}

function ProjectBodySkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_calc((100%_-_1.5rem)/3)] lg:items-start">
        <div className="h-80 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-48 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    </div>
  );
}

export default function ProjectPagePreview({
  preview,
  routeLoading = false,
}: {
  preview: ProjectPreview;
  /** Marks this as the route's loading screen for the top progress bar. */
  routeLoading?: boolean;
}) {
  // The phone's top bar carries the project's name, as on the page itself.
  useSetPageTitle("פרויקט", preview.name);

  return (
    <div
      className="space-y-3 md:space-y-5"
      data-route-loading={routeLoading ? "true" : undefined}
      aria-busy="true"
    >
      <ProjectMobileHeader
        status={preview.status ?? ""}
        typeLabel={projectTypeLabel(preview.projectType)}
        startDateText={preview.startDate ? formatShortDate(preview.startDate, "—") : null}
        endDateText={preview.endDate ? formatShortDate(preview.endDate, "—") : null}
      />
      <ProjectPageHeading
        customerId={preview.customerId}
        customerDisplayName={preview.customerName ?? ""}
        customerPhone={preview.customerPhone}
        projectName={preview.name}
        projectType={preview.projectType}
        actions={<ActionsSkeleton />}
      />
      <ProjectBodySkeleton />
    </div>
  );
}
