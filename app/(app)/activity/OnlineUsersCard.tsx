"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { PRESENCE_CHANNEL } from "@/components/layout/PresenceTracker";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PresenceRosterUser } from "@/lib/audit";

type PresenceMeta = { id?: string; name?: string; role?: string | null; online_at?: string };
type LivePresence = { authId: string; onlineAt: string | null; name: string; role: string | null };

// "last seen": within the last hour → "לפני X דק'"; earlier today → clock time;
// "אתמול HH:MM"; else a date. Always prefixed with "נראה לאחרונה".
function lastSeenLabel(iso: string | null, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "נראה לאחרונה עכשיו";
  if (min < 60) return `נראה לאחרונה לפני ${min} דק'`;
  const d = new Date(t);
  const hhmm = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now).toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString();
  if (d.toDateString() === today) return `נראה לאחרונה ${hhmm}`;
  if (d.toDateString() === yesterday) return `נראה לאחרונה אתמול ${hhmm}`;
  return `נראה לאחרונה ${d.toLocaleDateString("he-IL", { day: "numeric", month: "long" })}`;
}

function fmtDurMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "פחות מדקה";
  if (min < 60) return `${min} דק'`;
  const hrs = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hrs} שע' ${rem} דק'` : `${hrs} שע'`;
}

function fullTimestamp(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("he-IL", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

type Row = {
  id: string;
  name: string;
  role: string | null;
  avatarColor: string | null; // the user's chosen color (users.avatar_color)
  lastSeenAt: string | null;
  activeNow: boolean;
  sessionStart: string | null; // current live session start → "connected for X"
  lastSessionMs: number | null; // length of the most-recent session → shown when offline
};

export default function OnlineUsersCard({ roster }: { roster: PresenceRosterUser[] }) {
  const [live, setLive] = useState<LivePresence[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // Whether the offline "seen this month" list is fully expanded.
  const [showAll, setShowAll] = useState(false);

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
    const seen = new Set<string>();

    const merged: Row[] = roster.map((u) => {
      // Presence is keyed by auth.uid(), which equals users.id here — but match
      // auth_user_id too so either identity convention resolves.
      const presence =
        liveByAuth.get(u.id) ?? (u.authUserId ? liveByAuth.get(u.authUserId) ?? null : null);
      if (presence) seen.add(presence.authId);
      // "Online" = the live Realtime socket ONLY (like WhatsApp): it drops the
      // instant the user disconnects or logs out — no stale window. last_seen is
      // used only for the "נראה לאחרונה" label below, never to keep someone "online".
      const activeNow = !!presence;
      const lastSessionMs =
        u.sessionStartedAt && u.sessionLastSeenAt
          ? new Date(u.sessionLastSeenAt).getTime() - new Date(u.sessionStartedAt).getTime()
          : null;
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        avatarColor: u.avatarColor,
        lastSeenAt: u.lastSeenAt,
        activeNow,
        sessionStart: activeNow ? u.sessionStartedAt ?? presence?.onlineAt ?? null : null,
        lastSessionMs,
      };
    });

    // Anyone connected right now who isn't in the 30-day roster yet.
    for (const l of live) {
      if (seen.has(l.authId)) continue;
      merged.push({
        id: l.authId,
        name: l.name,
        role: l.role,
        avatarColor: null,
        lastSeenAt: l.onlineAt,
        activeNow: true,
        sessionStart: l.onlineAt,
        lastSessionMs: null,
      });
    }

    merged.sort((a, b) => {
      if (a.activeNow !== b.activeNow) return a.activeNow ? -1 : 1;
      const at = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bt = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return bt - at;
    });
    return merged;
    // nowMs isn't used here anymore (active is server-decided); the relative-time
    // labels below read nowMs directly and re-render on its 30s tick.
  }, [roster, live]);

  const activeCount = rows.filter((r) => r.activeNow).length;
  const inactiveRows = rows.filter((r) => !r.activeNow);
  const activeRows = rows.filter((r) => r.activeNow);

  // Keep the offline list short by default so the card doesn't become a wall of
  // names; the rest expand on tap.
  const VISIBLE_INACTIVE = 4;
  const shownInactive = showAll ? inactiveRows : inactiveRows.slice(0, VISIBLE_INACTIVE);
  const hiddenCount = inactiveRows.length - shownInactive.length;

  // One person as an avatar row: colored initials (with a green dot when live),
  // name + role, and a status line. Each piece is its own element so mixed
  // Hebrew / Latin / numbers don't get scrambled by RTL bidi reordering.
  const renderRow = (u: Row) => {
    const dur = fmtDurMs(u.sessionStart ? nowMs - new Date(u.sessionStart).getTime() : null);
    const seenLabel = lastSeenLabel(u.lastSeenAt, nowMs);
    const sessLabel = fmtDurMs(u.lastSessionMs);
    const status = u.activeNow
      ? dur
        ? `מחובר · ${dur}`
        : "מחובר כעת"
      : seenLabel || "לא מחובר";
    return (
      <div
        key={u.id}
        className="flex items-center gap-2.5 py-1.5"
        title={
          u.activeNow
            ? undefined
            : [
                u.lastSeenAt ? `נראה לאחרונה ${fullTimestamp(u.lastSeenAt)}` : "",
                sessLabel ? `משך ההתחברות האחרונה: ${sessLabel}` : "",
              ]
                .filter(Boolean)
                .join(" · ") || undefined
        }
      >
        <div className="relative shrink-0">
          <InitialsAvatar
            name={u.name}
            color={u.avatarColor}
            colorKey={u.name}
            size="sm"
            className={u.activeNow ? "" : "opacity-60"}
          />
          {u.activeNow && (
            <span className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-success-soft-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{u.name}</span>
            {u.role && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                {u.role}
              </span>
            )}
          </div>
          <div
            className={`truncate text-xs tabular-nums ${
              u.activeNow ? "text-success-soft-foreground" : "text-muted-foreground"
            }`}
          >
            {status}
          </div>
        </div>
      </div>
    );
  };

  // Desktop: the same person as a compact pill so a row of colleagues wraps
  // horizontally instead of a full-width list wasting the wide layout. Carries
  // the real avatar + chosen color, the name, role, and a short status.
  const renderPill = (u: Row) => {
    const dur = fmtDurMs(u.sessionStart ? nowMs - new Date(u.sessionStart).getTime() : null);
    const seenLabel = lastSeenLabel(u.lastSeenAt, nowMs);
    const status = u.activeNow ? (dur ? `מחובר · ${dur}` : "מחובר") : seenLabel || "לא מחובר";
    return (
      <span
        key={u.id}
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card py-1 pe-2.5 ps-1"
      >
        <span className="relative shrink-0">
          <InitialsAvatar
            name={u.name}
            color={u.avatarColor}
            colorKey={u.name}
            size="sm"
            className={u.activeNow ? "" : "opacity-60"}
          />
          {u.activeNow && (
            <span className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-success-soft-foreground" />
          )}
        </span>
        <span className="text-xs font-medium">{u.name}</span>
        {u.role && <span className="text-[10px] text-muted-foreground">{u.role}</span>}
        <span
          className={`text-[11px] tabular-nums ${
            u.activeNow ? "text-success-soft-foreground" : "text-muted-foreground"
          }`}
        >
          {`· ${status}`}
        </span>
      </span>
    );
  };

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-soft-foreground/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success-soft-foreground" />
          </span>
          <span className="text-sm font-medium">פעילות משתמשים</span>
          <span className="text-xs text-muted-foreground">
            {`${activeCount} מחובר${activeCount === 1 ? "" : "ים"} · ${rows.length} פעילים החודש`}
          </span>
        </div>

        {rows.length === 0 ? (
          <span className="text-xs text-muted-foreground">אין נתוני פעילות עדיין</span>
        ) : (
          <>
            {/* Mobile: a full-width avatar list (no room for a wrapping pill row). */}
            <div className="md:hidden">
              <div className="divide-y divide-border/40">
                {activeRows.map(renderRow)}
                {shownInactive.map(renderRow)}
              </div>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-2 text-xs font-medium text-secondary hover:underline"
                >
                  {`הצג עוד ${hiddenCount}`}
                </button>
              )}
              {showAll && inactiveRows.length > VISIBLE_INACTIVE && (
                <button
                  type="button"
                  onClick={() => setShowAll(false)}
                  className="mt-2 text-xs text-muted-foreground hover:underline"
                >
                  הצג פחות
                </button>
              )}
            </div>

            {/* Desktop: pills wrap in a row so the wide layout isn't wasted. */}
            <div className="hidden flex-wrap items-center gap-2 md:flex">
              {activeRows.map(renderPill)}
              {inactiveRows.map(renderPill)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
