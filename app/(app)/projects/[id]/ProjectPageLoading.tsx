"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import ProjectPagePreview from "@/app/(app)/projects/[id]/ProjectPagePreview";
import { forgetProjectPreview, readProjectPreview } from "@/app/(app)/projects/[id]/projectPreview";

// The project page's loading screen. Opened from the projects list, it already
// shows that project's header (what the row knew); from anywhere else — or on
// a full page load, where nothing was remembered — the plain skeleton.
export default function ProjectPageLoading() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  // Read once: the slot is cleared below when this screen goes away, and a
  // re-render in between must not swap the header for grey bars.
  const [preview] = useState(() => readProjectPreview(id));

  // Opened from a list scrolled down, the page has to start at its header.
  // Next's own scroll-to-top doesn't always fire (it can pick a <script> tag
  // the route brings along as "the page" and give up), and then the header
  // sits above the screen while the user looks at grey blocks.
  useLayoutEffect(() => {
    if (preview) window.scrollTo(0, 0);
  }, [preview]);

  useEffect(() => () => forgetProjectPreview(id), [id]);

  return preview ? <ProjectPagePreview preview={preview} routeLoading /> : <DetailPageSkeleton />;
}
