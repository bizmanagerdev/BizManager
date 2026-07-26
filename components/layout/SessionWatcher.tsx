"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Keeps every open tab on the CURRENTLY logged-in account.
 *
 * The browser auth client stores the session in cookies (@supabase/ssr), which do
 * NOT raise cross-tab storage events — so signing into a different account (or
 * signing out) in one tab leaves other tabs acting as the previous account until
 * they happen to reload. This watcher closes that gap: the tab that changed fires
 * onAuthStateChange, broadcasts it, and every tab whose rendered-for user no longer
 * matches the live session does a hard reload (which re-runs AuthGuard → correct
 * account, or a redirect to /login on sign-out). Routine token refreshes (same
 * user) are ignored, so this never reloads mid-session for no reason.
 */
export default function SessionWatcher() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    // The user this tab was rendered for. Captured once; a change means switch.
    let mountedUid: string | null = null;
    let ready = false;
    const bc =
      typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("bizh-auth") : null;

    void supabase.auth.getUser().then(({ data }) => {
      mountedUid = data.user?.id ?? null;
      ready = true;
    });

    const onUid = (uid: string | null) => {
      if (!ready) return;
      if (uid !== mountedUid) {
        // Account changed (or signed out) elsewhere → reflect it here.
        window.location.reload();
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
      const uid = session?.user?.id ?? null;
      bc?.postMessage({ uid });
      onUid(uid);
    });

    if (bc) bc.onmessage = (e) => onUid((e.data?.uid as string | null) ?? null);

    return () => {
      sub.subscription.unsubscribe();
      bc?.close();
    };
  }, []);

  return null;
}
