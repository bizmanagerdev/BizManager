"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { closeLocalDatabase, openLocalDatabase } from "@/lib/powersync/database";
import { registerLocalDataWipe } from "@/lib/powersync/store";
import { withSentry } from "@/lib/sentry-lazy";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import LocalPagesWarmup from "@/components/powersync/LocalPagesWarmup";

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
export default function LocalDataHost({ viewer }: { viewer?: LocalCardViewer }) {
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
        void closeLocalDatabase({ wipe: true });
      } else if (event === "SIGNED_IN" && session?.user.id) {
        void open(session.user.id);
      }
    });

    registerLocalDataWipe(() => closeLocalDatabase({ wipe: true }));

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
      registerLocalDataWipe(null);
      // Unmounting (e.g. leaving the app shell) keeps the copy; logout wipes it.
      void closeLocalDatabase({ wipe: false });
    };
  }, []);

  return viewer ? <LocalPagesWarmup viewer={viewer} /> : null;
}
