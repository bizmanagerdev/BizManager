"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PRESENCE_CHANNEL } from "@/components/layout/PresenceTracker";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OnlineUser = {
  id: string;
  name: string;
  role: string | null;
  online_at: string | null;
};

type PresenceMeta = {
  id?: string;
  name?: string;
  role?: string | null;
  online_at?: string;
};

export default function OnlineUsersCard() {
  const [users, setUsers] = useState<OnlineUser[]>([]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(PRESENCE_CHANNEL);

    const sync = () => {
      const state = channel.presenceState<PresenceMeta>();
      const list: OnlineUser[] = [];
      for (const key of Object.keys(state)) {
        const meta = state[key]?.[0];
        list.push({
          id: meta?.id ?? key,
          name: meta?.name ?? "משתמש",
          role: meta?.role ?? null,
          online_at: meta?.online_at ?? null,
        });
      }
      list.sort((a, b) => a.name.localeCompare(b.name, "he"));
      setUsers(list);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-soft-foreground/60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success-soft-foreground" />
            </span>
            <span className="text-sm font-medium">{`מחוברים כעת (${users.length})`}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {users.length === 0 ? (
              <span className="text-xs text-muted-foreground">אין משתמשים מחוברים</span>
            ) : (
              users.map((u) => (
                <Badge key={u.id} variant="secondary" className="text-xs">
                  {u.name}
                  {u.role ? ` · ${u.role}` : ""}
                </Badge>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
