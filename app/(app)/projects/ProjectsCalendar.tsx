"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CalendarEntry } from "@/lib/projectSchedule";
import { hebrewFullDate } from "@/lib/hebrew-calendar";
import MonthCalendar, {
  fmtFullDay,
  toDateOnly,
  type DayContext,
  type SelectedContext,
} from "@/components/ui/month-calendar";

function entryKindLabel(kind: CalendarEntry["kind"]) {
  if (kind === "task") return "משימה";
  if (kind === "reminder") return "תזכורת";
  return "פרויקט";
}

function entryKindVariant(kind: CalendarEntry["kind"]) {
  if (kind === "task") return "warning" as const;
  if (kind === "reminder") return "info" as const;
  return "secondary" as const;
}

function entryKindDot(kind: CalendarEntry["kind"]) {
  if (kind === "task") return "bg-warning";
  if (kind === "reminder") return "bg-info";
  return "bg-success";
}

export default function ProjectsCalendar({
  entries,
  todayIso,
}: {
  entries: CalendarEntry[];
  todayIso: string;
}) {
  const normalizedEntries = useMemo(
    () =>
      entries
        .map((e) => ({
          ...e,
          start: toDateOnly(e.startDate),
          end: toDateOnly(e.endDate) ?? toDateOnly(e.startDate),
        }))
        .filter((e) => {
          if (!e.start) return false;
          if (e.kind === "project") {
            const end = e.end ?? e.start;
            const days = (end.getTime() - e.start.getTime()) / 86_400_000;
            return days < 7;
          }
          return true;
        }),
    [entries]
  );

  function entriesOnDay(day: Date) {
    return normalizedEntries.filter((e) => {
      if (!e.start) return false;
      const end = e.end ?? e.start;
      return day >= e.start && day <= end;
    });
  }

  function renderSelectedPanel({ day, holiday, isToday }: SelectedContext) {
    const selectedEntries = entriesOnDay(day);
    return (
      <div className="rounded-2xl border bg-secondary/10 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold">{fmtFullDay(day)}</div>
            <div className="text-xs text-muted-foreground">{hebrewFullDate(day)}</div>
            {holiday ? (
              <div className="mt-0.5 text-sm font-medium text-info-soft-foreground">{holiday}</div>
            ) : null}
            <div className="text-sm text-muted-foreground">
              {selectedEntries.length > 0
                ? `${selectedEntries.length} פריטים`
                : "אין פריטים ביום זה"}
            </div>
          </div>
          {isToday && <Badge variant="default">היום</Badge>}
        </div>

        {selectedEntries.length > 0 ? (
          <div className="space-y-2">
            {selectedEntries.map((entry) => (
              <Link
                key={`${entry.kind}-${entry.id}`}
                href={entry.href}
                className="block rounded-xl border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.title}</span>
                  <Badge variant={entryKindVariant(entry.kind)}>{entryKindLabel(entry.kind)}</Badge>
                  {entry.priority && <StatusBadge value={entry.priority} type="priority" />}
                  {entry.status && entry.kind !== "reminder" && (
                    <StatusBadge value={entry.status} type={entry.kind === "task" ? "task" : "project"} />
                  )}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">{entry.subtitle}</div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">לחץ על יום כדי לראות פריטים.</div>
        )}
      </div>
    );
  }

  function renderDayContent({ day, holiday }: DayContext) {
    const dayEntries = entriesOnDay(day);
    const taskCount = dayEntries.filter((e) => e.kind === "task").length;
    const reminderCount = dayEntries.filter((e) => e.kind === "reminder").length;
    const projectCount = dayEntries.filter((e) => e.kind === "project").length;

    return (
      <>
        {/* Holiday name (truncated) */}
        {holiday ? (
          <span className="max-w-full truncate text-[9px] leading-tight text-primary/80">
            {holiday}
          </span>
        ) : null}

        {/* Event dots */}
        {(taskCount > 0 || reminderCount > 0 || projectCount > 0) && (
          <div className="flex gap-0.5">
            {taskCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
            {reminderCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-info" />}
            {projectCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
          </div>
        )}

        {/* Overflow count */}
        {dayEntries.length > 0 && (
          <span className="text-[10px] leading-none text-muted-foreground">
            {dayEntries.length}
          </span>
        )}
      </>
    );
  }

  function renderDayHover({ day }: DayContext) {
    const dayEntries = entriesOnDay(day);
    if (dayEntries.length === 0) return null;
    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-1.5">
          <span className="text-sm font-semibold">{fmtFullDay(day)}</span>
          <span className="text-xs text-muted-foreground">{dayEntries.length} פריטים</span>
        </div>
        <ul className="space-y-1">
          {dayEntries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="flex items-center gap-1.5 text-xs">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${entryKindDot(entry.kind)}`} />
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{entryKindLabel(entry.kind)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <MonthCalendar
      todayIso={todayIso}
      renderSelectedPanel={renderSelectedPanel}
      renderDayContent={renderDayContent}
      renderDayHover={renderDayHover}
      legend={
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />משימה</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" />תזכורת</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />פרויקט</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" />חג / מועד</span>
        </div>
      }
    />
  );
}
