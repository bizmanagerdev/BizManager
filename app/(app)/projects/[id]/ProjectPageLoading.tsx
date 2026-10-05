"use client";

import { useParams } from "next/navigation";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import ProjectPagePreview from "@/app/(app)/projects/[id]/ProjectPagePreview";
import { projectPreviewSlot } from "@/app/(app)/projects/[id]/projectPreview";
import { useRoutePreview } from "@/hooks/useRoutePreview";

// The project page's loading screen. Opened from the projects list, it already
// shows that project's header (what the row knew); from anywhere else — or on
// a full page load, where nothing was remembered — the plain skeleton.
export default function ProjectPageLoading() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const preview = useRoutePreview(projectPreviewSlot, id);

  return preview ? <ProjectPagePreview preview={preview} routeLoading /> : <DetailPageSkeleton />;
}
