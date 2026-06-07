"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CalendarEntry } from "@/lib/projectSchedule";

type TimelineEvent = {
  id: string;
  kind: "task" | "reminder" | "project-start" | "project-end";
  title: string;
  subtitle: string;
  href: string;
  status: string | null;
  priority: string | null;
};

type DayBucket = {
  date: Date;
  dateIso: string;
  label: string;
  isToday: boolean;
  isTomorrow: boolean;
  events: TimelineEvent[];
};

function toDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDayLabel(d: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

export default function AlertsTimeline({
  entries,
  todayIso,
  days = 21,
}: {
  entries: CalendarEntry[];
  todayIso: string;
  days?: number;
}) {
  const buckets = useMemo<DayBucket[]>(() => {
    const today = toDateOnly(todayIso) ?? new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowIso = toIso(tomorrow);
    const rangeEnd = new Date(today);
    rangeEnd.setDate(rangeEnd.getDate() + days - 1);

    // Build map: iso-date → events
    const map = new Map<string, TimelineEvent[]>();

    const addEvent = (iso: string, event: TimelineEvent) => {
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso)!.push(event);
    };

    for (const entry of entries) {
      const start = toDateOnly(entry.startDate);
      const end = toDateOnly(entry.endDate) ?? start;
      if (!start) continue;

      if (entry.kind === "task" || entry.kind === "reminder") {
        const iso = toIso(start);
        if (start >= today && start <= rangeEnd) {
          addEvent(iso, {
            id: entry.id,
            kind: entry.kind,
            title: entry.title,
            subtitle: entry.subtitle,
            href: entry.href,
            status: entry.status,
            priority: entry.priority,
          });
        }
      } else {
        // Project: show on start and on end (if different and within range)
        if (start >= today && start <= rangeEnd) {
          addEvent(toIso(start), {
            id: `${entry.id}-start`,
            kind: "project-start",
            title: entry.title,
            subtitle: entry.subtitle,
            href: entry.href,
            status: entry.status,
            priority: null,
          });
        }
        if (end && end !== start && end >= today && end <= rangeEnd) {
          addEvent(toIso(end), {
            id: `${entry.id}-end`,
            kind: "project-end",
            title: entry.title,
            subtitle: entry.subtitle,
            href: entry.href,
            status: entry.status,
            priority: null,
          });
        }
      }
    }

    // Build day buckets (only days with events, plus today always shown)
    const result: DayBucket[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = toIso(d);
      const events = map.get(iso) ?? [];
      if (i === 0 || events.length > 0) {
        result.push({
          date: d,
          dateIso: iso,
          label: fmtDayLabel(d),
          isToday: iso === todayIso,
          isTomorrow: iso === tomorrowIso,
          events,
        });
      }
    }
    return result;
  }, [entries, todayIso, days]);

  if (buckets.every((b) => b.events.length === 0)) {
    return (
      <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        אין אירועים מתוזמנים ב-{days} הימים הקרובים.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {buckets.map((bucket) => (
        <div key={bucket.dateIso}>
          {/* Day header */}
          <div
            className={`flex items-center gap-3 py-2 ${
              bucket.isToday ? "sticky top-0 z-10 bg-background" : ""
            }`}
          >
            <div
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                bucket.isToday
                  ? "bg-primary text-primary-foreground"
                  : bucket.isTomorrow
                    ? "bg-secondary/20 text-secondary"
                    : "bg-background text-muted-foreground"
              }`}
            >
              {bucket.isToday ? "היום" : bucket.isTomorrow ? "מחר" : null}
              {!bucket.isToday && !bucket.isTomorrow ? bucket.label : (
                <span className="mr-1 opacity-70">{bucket.label}</span>
              )}
            </div>
            {bucket.events.length === 0 && (
              <span className="text-xs text-muted-foreground">אין אירועים</span>
            )}
          </div>

          {/* Events */}
          {bucket.events.length > 0 && (
            <div className="mb-3 space-y-2 pr-2">
              {bucket.events.map((event) => (
                <Link
                  key={event.id}
                  href={event.href}
                  className="flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-secondary/10"
                >
                  <EventDot kind={event.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium leading-tight">{event.title}</span>
                      <EventKindBadge kind={event.kind} />
                      {event.priority && (
                        <StatusBadge value={event.priority} type="priority" />
                      )}
                      {event.status && event.kind !== "reminder" && (
                        <StatusBadge
                          value={event.status}
                          type={event.kind === "task" ? "task" : "project"}
                        />
                      )}
                    </div>
                    {event.subtitle && (
                      <div className="mt-0.5 truncate text-sm text-muted-foreground">
                        {event.subtitle}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EventDot({ kind }: { kind: TimelineEvent["kind"] }) {
  const colors = {
    task: "bg-warning",
    reminder: "bg-info",
    "project-start": "bg-success",
    "project-end": "bg-destructive",
  };
  return (
    <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${colors[kind]}`} />
  );
}

function EventKindBadge({ kind }: { kind: TimelineEvent["kind"] }) {
  if (kind === "task") return <Badge variant="warning" className="text-[10px]">משימה</Badge>;
  if (kind === "reminder") return <Badge variant="info" className="text-[10px]">תזכורת</Badge>;
  if (kind === "project-start") return <Badge variant="secondary" className="text-[10px]">פרויקט מתחיל</Badge>;
  return <Badge variant="outline" className="text-[10px]">פרויקט מסתיים</Badge>;
}
