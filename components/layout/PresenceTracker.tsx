"use client";

import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const PRESENCE_CHANNEL = "presence:online";

type Props = {
  userName?: string;
  viewerRole?: string;
};

/**
 * Mounted in AppShell so every authenticated user (on any page) advertises their
 * presence on a shared channel. Admins can then see who is using the system live.
 * Keyed by the auth user id so multiple tabs collapse into a single online user.
 */
export default function PresenceTracker({ userName, viewerRole }: Props) {
  // One session id per browser tab (survives re-renders). Drives user_sessions so
  // "active now" is server-authoritative — the admin bar sees this user regardless
  // of whether ephemeral Realtime presence connected.
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    // The user this tab is currently tracking. Follows the live auth session, so
    // logging into a different account (even in another tab) hands presence over
    // to the new account and stops advertising the logged-out one.
    let trackedId: string | null = null;

    const beat = async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null;
      const { error } = await supabase.rpc("session_heartbeat", {
        p_session_id: sid,
        p_user_agent: ua,
      });
      if (error) console.warn("[presence] session_heartbeat failed:", error.message);
    };

    const stopTracking = async () => {
      if (!channel) return;
      const c = channel;
      channel = null;
      await supabase.removeChannel(c);
    };

    // Advertise + heartbeat as `userId` (or clear everything when signed out).
    const trackAs = async (userId: string | null) => {
      if (userId === trackedId) return;
      await stopTracking();
      trackedId = userId;
      if (!userId) return;

      // Fresh session id per identity so switching accounts never reuses a row.
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        sessionIdRef.current = crypto.randomUUID();
      }
      void beat();

      channel = supabase.channel(PRESENCE_CHANNEL, {
        config: { presence: { key: userId } },
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel?.track({
            id: userId,
            name: userName ?? "משתמש",
            role: viewerRole ?? null,
            online_at: new Date().toISOString(),
          });
        }
      });
    };

    // onAuthStateChange emits the current session on subscribe (INITIAL_SESSION)
    // and again on every SIGNED_IN / SIGNED_OUT / token change — so this always
    // reflects whoever is logged in right now. Deferred to avoid the documented
    // deadlock when calling Supabase inside the callback.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setTimeout(() => void trackAs(uid), 0);
    });

    const heartbeat = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void beat();
    }, 60_000);

    return () => {
      clearInterval(heartbeat);
      sub.subscription.unsubscribe();
      void stopTracking();
    };
  }, [userName, viewerRole]);

  return null;
}
