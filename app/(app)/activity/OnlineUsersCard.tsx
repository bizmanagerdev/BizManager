"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PRESENCE_CHANNEL } from "@/components/layout/PresenceTracker";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PresenceRosterUser } from "@/lib/audit";

type PresenceMeta = {
  id?: string;
  name?: string;
  role?: string | null;
  online_at?: string;
};

// A user still counts as "connected now" if their heartbeat landed within this
// window, even if the live presence socket momentarily dropped them.
const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

function relativeSince(iso: string | null, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} דק'`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `לפני ${hrs} שע'`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(t).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

function formatDuration(fromIso: string | null, toMs: number): string {
  if (!fromIso) return "";
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from) || toMs <= from) return "";
  const min = Math.round((toMs - from) / 60000);
  if (min < 1) return "פחות מדקה";
  if (min < 60) return `${min} דק'`;
  const hrs = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hrs} שע' ${rem} דק'` : `${hrs} שע'`;
}

type Row = {
  id: string;
  authUserId: string | null;
  name: string;
  role: string | null;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  activeNow: boolean;
  // When active: the current session's start (presence online_at, else last login).
  sessionStart: string | null;
};

type LivePresence = { authId: string; onlineAt: string | null; name: string; role: string | null };

export default function OnlineUsersCard({ roster }: { roster: PresenceRosterUser[] }) {
  const [live, setLive] = useState<LivePresence[]>([]);
  // Re-render every 30s so relative times / durations stay fresh.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(PRESENCE_CHANNEL);

    const sync = () => {
      const state = channel.presenceState<PresenceMeta>();
      const list: LivePresence[] = [];
      for (const key of Object.keys(state)) {
        const meta = state[key]?.[0];
        list.push({
          authId: meta?.id ?? key,
          onlineAt: meta?.online_at ?? null,
          name: meta?.name ?? "משתמש",
          role: meta?.role ?? null,
        });
      }
      setLive(list);
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

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo<Row[]>(() => {
    const liveByAuth = new Map(live.map((l) => [l.authId, l] as const));
    const seenAuthIds = new Set<string>();

    const merged: Row[] = roster.map((u) => {
      const presence = u.authUserId ? liveByAuth.get(u.authUserId) ?? null : null;
      if (presence) seenAuthIds.add(presence.authId);
      const recentlySeen =
        !!u.lastSeenAt && nowMs - new Date(u.lastSeenAt).getTime() < ACTIVE_WINDOW_MS;
      const activeNow = !!presence || recentlySeen;
      return {
        id: u.id,
        authUserId: u.authUserId,
        name: u.name,
        role: u.role,
        lastSeenAt: u.lastSeenAt,
        lastLoginAt: u.lastLoginAt,
        activeNow,
        sessionStart: activeNow ? presence?.onlineAt ?? u.lastLoginAt : null,
      };
    });

    // Anyone connected right now who wasn't in the 30-day roster (e.g. their
    // first heartbeat hadn't been written when the page loaded).
    for (const l of live) {
      if (seenAuthIds.has(l.authId)) continue;
      merged.push({
        id: l.authId,
        authUserId: l.authId,
        name: l.name,
        role: l.role,
        lastSeenAt: l.onlineAt,
        lastLoginAt: l.onlineAt,
        activeNow: true,
        sessionStart: l.onlineAt,
      });
    }

    merged.sort((a, b) => {
      if (a.activeNow !== b.activeNow) return a.activeNow ? -1 : 1;
      if (a.activeNow) return a.name.localeCompare(b.name, "he");
      const at = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bt = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return bt - at;
    });
    return merged;
  }, [roster, live, nowMs]);

  const activeCount = rows.filter((r) => r.activeNow).length;

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-soft-foreground/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success-soft-foreground" />
          </span>
          <span className="text-sm font-medium">{`מחוברים כעת (${activeCount})`}</span>
          {rows.length > activeCount && (
            <span className="text-xs text-muted-foreground">
              {`· ${rows.length - activeCount} פעילים החודש`}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <span className="text-xs text-muted-foreground">אין נתוני פעילות עדיין</span>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {rows.map((u) => {
              // Each segment is its own flex child so mixed Hebrew / Latin (role) /
              // numbers (duration) don't get scrambled by RTL bidi reordering — a
              // single concatenated string rendered "סורוצקין · 21 · admin דק'".
              if (u.activeNow) {
                const dur = formatDuration(u.sessionStart, nowMs);
                return (
                  <Badge
                    key={u.id}
                    variant="info-soft"
                    className="gap-1 text-xs font-medium"
                    title={dur ? `מחובר ${dur}` : "מחובר כעת"}
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                    <span>{u.name}</span>
                    {u.role && <span aria-hidden className="opacity-40">·</span>}
                    {u.role && <span className="opacity-80">{u.role}</span>}
                    {dur && <span aria-hidden className="opacity-40">·</span>}
                    {dur && <span className="tabular-nums opacity-80">{dur}</span>}
                  </Badge>
                );
              }
              const lastSession = formatDuration(u.lastLoginAt, u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : 0);
              return (
                <Badge
                  key={u.id}
                  variant="outline"
                  className="gap-1 text-xs text-muted-foreground"
                  title={lastSession ? `היה מחובר ${lastSession}` : undefined}
                >
                  <span>{u.name}</span>
                  <span aria-hidden className="opacity-40">·</span>
                  <span className="tabular-nums">{relativeSince(u.lastSeenAt, nowMs)}</span>
                </Badge>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
