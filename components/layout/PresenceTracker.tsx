"use client";

import { useEffect } from "react";
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
  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId || !active) return;

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
    })();

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userName, viewerRole]);

  return null;
}
