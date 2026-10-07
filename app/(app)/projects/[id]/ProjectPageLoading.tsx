"use client";

import { useParams } from "next/navigation";
import ProjectPageOpening from "@/app/(app)/projects/[id]/ProjectPageOpening";
import { projectPreviewSlot } from "@/app/(app)/projects/[id]/projectPreview";
import { useRoutePreview } from "@/hooks/useRoutePreview";

// The project page's loading screen: the page itself from this device's copy
// when it has one (ProjectPageOpening); otherwise, opened from the projects
// list, that project's header (what the row knew); from anywhere else — or on
// a full page load, where nothing was remembered — the plain skeleton.
export default function ProjectPageLoading() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const preview = useRoutePreview(projectPreviewSlot, id);

  return <ProjectPageOpening id={id} preview={preview} routeLoading />;
}
