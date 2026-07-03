"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { refreshNotifications } from "@/lib/ui/notifications-store";

// Keeps the bell live: when a new notification row is inserted for me, refresh
// the store so the badge/history update without waiting for the poll.
export default function NotificationsRealtime() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const uid = data.session?.user?.id;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled || !uid) return;

      channel = supabase
        .channel("notifications-bell")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => refreshNotifications()
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
