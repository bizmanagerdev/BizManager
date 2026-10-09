"use client";

import { useParams, usePathname } from "next/navigation";
import ProjectPageOpening from "@/app/(app)/projects/[id]/ProjectPageOpening";
import ProjectExportSkeleton from "@/app/(app)/projects/[id]/export/ProjectExportSkeleton";
import { projectPreviewSlot } from "@/app/(app)/projects/[id]/projectPreview";
import { useRoutePreview } from "@/hooks/useRoutePreview";

// The project page's loading screen: the page itself from this device's copy
// when it has one (ProjectPageOpening); otherwise, opened from the projects
// list, that project's header (what the row knew); from anywhere else — or on
// a full page load, where nothing was remembered — the plain skeleton.
// `id`: for the projects list's own loading screen, which the router can show
// on the way to a project (it has no [id] param of its own).
export default function ProjectPageLoading({ id: idProp }: { id?: string } = {}) {
  const params = useParams<{ id: string }>();
  const id = idProp ?? (typeof params?.id === "string" ? params.id : "");
  const preview = useRoutePreview(projectPreviewSlot, id);
  // This is also what the router shows on the way to the project's work
  // sheet (its boundary is the outer one): the sheet's shape there.
  const pathname = usePathname();
  if (pathname?.endsWith("/export")) {
    return (
      <div data-route-loading="true">
        <ProjectExportSkeleton />
      </div>
    );
  }

  return <ProjectPageOpening id={id} preview={preview} routeLoading />;
}
