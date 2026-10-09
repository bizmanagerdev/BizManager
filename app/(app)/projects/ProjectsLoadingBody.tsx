"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import ProjectPageLoading from "@/app/(app)/projects/[id]/ProjectPageLoading";
import ProjectExportSkeleton from "@/app/(app)/projects/[id]/export/ProjectExportSkeleton";
import { ProjectsStripSkeleton } from "@/app/(app)/projects/ProjectsListSkeleton";

// The projects list's loading screen is also what the router shows on the way
// from the list to a project's page (owner's report, 2026-10-08: a phone saw
// an empty list skeleton between the tapped project's preview and its page —
// and the list's search strip it holds open folded away when the page came,
// moving everything up by its height, counted as a layout shift). So it looks
// at the address: the list — its skeleton with the strip held open; a
// project's page — that project's own loading screen (its preview), no strip;
// its work sheet — the sheet's shape; anything else under /projects — the
// skeleton without the strip.

const PROJECT_PAGE = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const EXPORT_PAGE = /^\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/export$/i;

export default function ProjectsLoadingBody({ list }: { list: ReactNode }) {
  const pathname = usePathname() ?? "/projects";
  const projectId = PROJECT_PAGE.exec(pathname)?.[1];
  if (projectId) return <ProjectPageLoading id={projectId} />;
  if (EXPORT_PAGE.test(pathname)) {
    return (
      <div data-route-loading="true">
        <ProjectExportSkeleton />
      </div>
    );
  }
  return (
    <>
      {/* The list's search / filter row: its strip held open on a phone (with
          their shape in it), so the page arriving doesn't push everything down. */}
      {pathname === "/projects" ? <ProjectsStripSkeleton /> : null}
      {list}
    </>
  );
}
