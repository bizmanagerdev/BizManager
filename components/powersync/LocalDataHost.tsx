"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { closeLocalDatabase, openLocalDatabase } from "@/lib/powersync/database";
import { registerLocalDataWipe, setLocalViewer, useLocalSyncStatus } from "@/lib/powersync/store";
import DeviceSaveNotices from "@/components/powersync/DeviceSaveNotices";
import { clearStoredResults } from "@/lib/powersync/stored-results";
import { clearPicture } from "@/lib/dashboard/picture";
import { withSentry } from "@/lib/sentry-lazy";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import LocalPagesWarmup from "@/components/powersync/LocalPagesWarmup";
import { installNavigationTiming } from "@/lib/ui/navigation-timing";
import { clearDeviceFrames, keepDeviceFramesFor } from "@/lib/powersync/device-frames";
import { setDeviceCopyPending } from "@/lib/powersync/device-pending";

// Keeps the on-device copy open for the signed-in person, in the background.
// Renders nothing. AppShell mounts it only for people the copy is switched on
// for (lib/powersync/config.ts) and loads it with ssr: false, so the PowerSync
// SDK never reaches anyone else's browser or the server.
//
// - signed in: open this person's database and start syncing;
// - someone else signs in on this device: wipe the previous person's copy;
// - signed out (here or in another tab): wipe.
// With the signed-in person's details (`viewer`), it also keeps their
// device-version pages ready in the background (LocalPagesWarmup).
// The page results stored on the device (lib/powersync/stored-results.ts) and
// the dashboard's picture (lib/dashboard/picture.ts) go with the copy: wiped
// at logout, and anyone else's dropped when this person is signed in.
// Until this device's copy has finished its first download, the server sends
// the device pages' server version (lib/powersync/device-pending.ts); the
// moment it has, they switch over by themselves.
export default function LocalDataHost({ viewer }: { viewer?: LocalCardViewer & { name?: string | null } }) {
  const viewerId = viewer?.userId;
  const viewerRole = viewer?.role;
  const viewerLocale = viewer?.locale ?? "he";
  const viewerName = viewer?.name ?? null;
  // Whose the copy is: for the saves made on it (lib/tasks/device-task-saves.ts)
  // and the pages drawn from it before they arrive (an order's, on a tap).
  useEffect(() => {
    setLocalViewer(
      viewerId && viewerRole ? { id: viewerId, role: viewerRole, locale: viewerLocale, name: viewerName } : null
    );
    return () => setLocalViewer(null);
  }, [viewerId, viewerRole, viewerLocale, viewerName]);
  useEffect(() => {
    if (!viewerId) return;
    clearStoredResults(viewerId);
    clearPicture(viewerId);
    keepDeviceFramesFor(viewerId);
  }, [viewerId]);

  const status = useLocalSyncStatus();
  const copyComplete = status ? status.hasSynced : null;
  useEffect(() => {
    if (copyComplete !== null) setDeviceCopyPending(!copyComplete);
  }, [copyComplete]);

  // From here on, page changes are timed (the device pages' timing report).
  useEffect(() => installNavigationTiming(), []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    const open = (authUid: string) =>
      openLocalDatabase(authUid).catch((error) => {
        withSentry((Sentry) =>
          Sentry.captureException(error, { tags: { area: "powersync" }, fingerprint: ["powersync", "open failed"] })
        );
      });

    void supabase.auth.getSession().then(({ data }) => {
      const authUid = data.session?.user.id;
      if (!cancelled && authUid) void open(authUid);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearStoredResults();
        clearPicture();
        void clearDeviceFrames();
        void closeLocalDatabase({ wipe: true });
      } else if (event === "SIGNED_IN" && session?.user.id) {
        void open(session.user.id);
      }
    });

    registerLocalDataWipe(() => {
      clearStoredResults();
      clearPicture();
      return closeLocalDatabase({ wipe: true });
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
      registerLocalDataWipe(null);
      // Unmounting (e.g. leaving the app shell) keeps the copy; logout wipes it.
      void closeLocalDatabase({ wipe: false });
    };
  }, []);

  return (
    <>
      <DeviceSaveNotices locale={viewer?.locale ?? "he"} />
      {viewer ? <LocalPagesWarmup viewer={viewer} /> : null}
    </>
  );
}
