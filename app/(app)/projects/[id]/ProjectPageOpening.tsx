"use client";

import ProjectPageSkeleton from "@/app/(app)/projects/[id]/ProjectPageSkeleton";
import { localDataPageOn } from "@/lib/powersync/config";
import { DEFAULT_LEDGER_PREFS } from "@/lib/projectLedgerPrefs";
import { useLocalDatabase, useLocalSyncStatus, useLocalViewer } from "@/lib/powersync/store";
import LocalProjectPage, { rememberedLedgerPrefs } from "@/app/(app)/projects/[id]/LocalProjectPage";
import ProjectPagePreview from "@/app/(app)/projects/[id]/ProjectPagePreview";
import type { ProjectPreview } from "@/app/(app)/projects/[id]/projectPreview";

// A project's page before the server's answer for it has arrived — over the
// projects list the moment a row is tapped, and as the page's loading screen.
// With a complete copy of the data on this device, the page itself, drawn from
// it (LocalProjectPage); otherwise the project's header from its list row
// (ProjectPagePreview), or grey blocks.
export default function ProjectPageOpening({
  id,
  preview,
  routeLoading = false,
}: {
  id: string;
  preview: ProjectPreview | null;
  /** The route's loading screen (for the top progress bar). */
  routeLoading?: boolean;
}) {
  const viewer = useLocalViewer();
  const db = useLocalDatabase();
  const status = useLocalSyncStatus();
  if (viewer && db && status?.hasSynced && localDataPageOn("projectPage", viewer)) {
    return (
      <LocalProjectPage
        id={id}
        viewer={{
          userId: viewer.id,
          role: viewer.role,
          locale: viewer.locale,
          ledgerPrefs: rememberedLedgerPrefs(viewer.id) ?? DEFAULT_LEDGER_PREFS,
        }}
        extras={null}
        preview={preview}
      />
    );
  }
  return preview ? <ProjectPagePreview preview={preview} routeLoading={routeLoading} /> : <ProjectPageSkeleton routeLoading={routeLoading} />;
}
