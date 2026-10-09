"use client";

import { useSetPageTitle } from "@/components/layout/page-title-context";
import { HeaderActionsPlaceholder } from "@/components/layout/HeaderActionsMenu";
import ProjectMobileHeader from "@/app/(app)/projects/[id]/ProjectMobileHeader";
import ProjectPageHeading, { projectTypeLabel } from "@/app/(app)/projects/[id]/ProjectPageHeading";
import type { ProjectPreview } from "@/app/(app)/projects/[id]/projectPreview";
import ProjectPageSkeleton from "@/app/(app)/projects/[id]/ProjectPageSkeleton";
import { formatShortDate } from "@/lib/date";

// A project page before its data arrives: the real header — drawn by the same
// components as the page, from what the projects list knew — over the page's
// own frame with blanks where the figures will be (ProjectPageSkeleton), so
// when the page lands the header doesn't move and the blanks fill in.
// Rendered over the list the moment a row is tapped (RouteOpeningOverlay) and
// as the page's loading screen (ProjectPageLoading).

// The page's ⋮ (ProjectDetailsActions' header menu), held in place until it
// arrives — one element, so the bar's title isn't re-set on every render.
const HEADER_MENU_PLACEHOLDER = <HeaderActionsPlaceholder />;

function ActionsSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-9 w-20 animate-pulse rounded-md bg-muted/60" />
      ))}
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
  // The phone's top bar carries the project's name, as on the page itself —
  // beside the ⋮ the page will put there, so the name wraps the same way now
  // as it will then.
  useSetPageTitle("פרויקט", preview.name, HEADER_MENU_PLACEHOLDER);

  return (
    <ProjectPageSkeleton
      routeLoading={routeLoading}
      header={
        <>
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
        </>
      }
    />
  );
}
