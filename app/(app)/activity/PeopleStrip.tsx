"use client";

import { useEffect, useMemo, useState } from "react";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { PRESENCE_CHANNEL } from "@/components/layout/PresenceTracker";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PresenceRosterUser } from "@/lib/audit";
import type { PersonDay } from "@/lib/activity/today";
import { israelClock, israelDayKeyOf, shiftDayKey } from "@/lib/activity/days";
import { israelDateKey } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// "מי עובד עכשיו" — everyone who works in the system: a green dot on whoever
// is connected right now, and how many actions each did today. Tapping a
// person opens their day (their card, and only their actions below).

type PresenceMeta = { id?: string; name?: string; role?: string | null; online_at?: string };
type LivePresence = { authId: string; onlineAt: string | null; name: string; role: string | null };

export type PresenceRow = {
  id: string;
  name: string;
  role: string | null;
  avatarColor: string | null;
  lastSeenAt: string | null;
  activeNow: boolean;
  /** The current session's start, while connected ("מחובר · 2 שע'"). */
  sessionStart: string | null;
};

/**
 * The roster joined with who's connected this moment: the server's heartbeat
 * (reliable), the presence socket when it connects, and the viewer — who is
 * plainly here. Newest first.
 */
export function usePresenceRows(roster: PresenceRosterUser[]): PresenceRow[] {
  const [live, setLive] = useState<LivePresence[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    // A timed-out auth lock rejects this; losing the viewer only means they
    // aren't marked online before the heartbeat says so.
    supabase.auth
      .getUser()
      .then(({ data }) => setViewerId(data.user?.id ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(PRESENCE_CHANNEL);
    const sync = () => {
      const state = channel.presenceState<PresenceMeta>();
      setLive(
        Object.keys(state).map((key) => {
          const meta = state[key]?.[0];
          return { authId: meta?.id ?? key, onlineAt: meta?.online_at ?? null, name: meta?.name ?? "משתמש", role: meta?.role ?? null };
        })
      );
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

  return useMemo(() => {
    const liveById = new Map(live.map((l) => [l.authId, l] as const));
    const seen = new Set<string>();
    const rows: PresenceRow[] = roster.map((u) => {
      const presence = liveById.get(u.id) ?? (u.authUserId ? liveById.get(u.authUserId) ?? null : null);
      if (presence) seen.add(presence.authId);
      const isViewer = !!viewerId && (u.id === viewerId || u.authUserId === viewerId);
      const activeNow = u.activeNow || !!presence || isViewer;
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        avatarColor: u.avatarColor,
        lastSeenAt: u.lastSeenAt,
        activeNow,
        sessionStart: activeNow ? u.sessionStartedAt ?? presence?.onlineAt ?? null : null,
      };
    });
    for (const l of live) {
      if (seen.has(l.authId)) continue;
      rows.push({ id: l.authId, name: l.name, role: l.role, avatarColor: null, lastSeenAt: l.onlineAt, activeNow: true, sessionStart: l.onlineAt });
    }
    return rows;
  }, [roster, live, viewerId]);
}

function shortDuration(fromIso: string | null, nowMs: number): string {
  if (!fromIso) return "";
  const min = Math.floor((nowMs - new Date(fromIso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return "עכשיו";
  if (min < 60) return `${min} דק'`;
  const hrs = Math.floor(min / 60);
  return `${hrs} שע'`;
}

/** "לפני 5 דק'", "14:20", "אתמול", "3.10" — when someone was last here. */
export function lastSeenShort(iso: string | null, nowMs: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor((nowMs - t) / 60000);
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} דק'`;
  const day = israelDayKeyOf(iso);
  const today = israelDateKey(new Date(nowMs));
  if (day === today) return israelClock(iso);
  if (day === shiftDayKey(today, -1)) return "אתמול";
  const [, m, d] = (day ?? "").split("-").map(Number);
  return d && m ? `${d}.${m}` : "";
}

export default function PeopleStrip({
  rows,
  people,
  selected,
  onSelect,
}: {
  /** Everyone, with who's connected now (usePresenceRows). */
  rows: PresenceRow[];
  people: PersonDay[];
  selected: string;
  onSelect: (userId: string) => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dayById = useMemo(() => new Map(people.map((p) => [p.userId, p] as const)), [people]);
  // Who was connected last comes first (owner, 2026-10-12): whoever is
  // connected now, then the most recently seen.
  const sorted = useMemo(() => {
    const seen = (r: PresenceRow) =>
      r.activeNow ? Number.POSITIVE_INFINITY : r.lastSeenAt ? Date.parse(r.lastSeenAt) || 0 : 0;
    return [...rows].sort(
      (a, b) =>
        seen(b) - seen(a) || (b.sessionStart ?? "").localeCompare(a.sessionStart ?? "") || a.id.localeCompare(b.id)
    );
  }, [rows]);

  const onlineCount = rows.filter((r) => r.activeNow).length;
  const activeToday = people.filter((p) => p.actions > 0).length;

  return (
    <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm sm:p-4" aria-label="מי עובד עכשיו">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-base font-semibold text-foreground">מי עובד עכשיו</h2>
        <span className="text-xs text-muted-foreground">
          {`${onlineCount === 1 ? "מחובר אחד" : `${onlineCount} מחוברים`} · ${activeToday === 1 ? "אחד פעיל היום" : `${activeToday} פעילים היום`}`}
        </span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">אין עדיין נתוני פעילות</p>
      ) : (
        // A row that scrolls sideways on a phone and wraps on a wide screen.
        <ul className="-mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden">
          {sorted.map((r) => {
            const day = dayById.get(r.id);
            const count = day?.actions ?? 0;
            const isSelected = selected === r.id;
            const status = r.activeNow ? `מחובר · ${shortDuration(r.sessionStart, nowMs) || "עכשיו"}` : lastSeenShort(r.lastSeenAt, nowMs);
            return (
              <li key={r.id} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? "" : r.id)}
                  aria-pressed={isSelected}
                  title={r.activeNow ? `${r.name} מחובר עכשיו` : `${r.name} · נראה לאחרונה ${status}`}
                  className={cn(
                    "flex w-[4.75rem] flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-center transition-colors",
                    isSelected ? "bg-secondary/15 ring-2 ring-secondary" : "hover:bg-accent/50",
                    !r.activeNow && count === 0 && !isSelected && "opacity-60"
                  )}
                >
                  <span className="relative">
                    <InitialsAvatar name={r.name} color={r.avatarColor} colorKey={r.name} size="md" />
                    {r.activeNow ? (
                      <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-card bg-success-soft-foreground" />
                    ) : null}
                    {count > 0 ? (
                      <span className="absolute -top-1 -start-2 min-w-5 rounded-full bg-secondary px-1 text-[0.588rem] font-bold leading-5 text-secondary-foreground tabular-nums">
                        {count}
                      </span>
                    ) : null}
                  </span>
                  <span className="w-full break-words text-xs font-medium leading-tight text-foreground">{r.name.split(/\s+/)[0]}</span>
                  <span
                    className={cn(
                      "w-full break-words text-[0.588rem] leading-tight tabular-nums",
                      r.activeNow ? "text-success-soft-foreground" : "text-muted-foreground"
                    )}
                  >
                    {status || "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
