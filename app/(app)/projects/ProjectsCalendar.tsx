"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CalendarEntry } from "@/lib/projectSchedule";
import { hebrewDayLabel, hebrewFullDate, getHolidaysInRange } from "@/lib/hebrew-calendar";

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDateOnly(value: string | null) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtMonthYear(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}

function fmtFullDay(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(d);
}

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

// Sunday–Saturday header labels (right-to-left in RTL)
const WEEK_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

export default function ProjectsCalendar({
  entries,
  todayIso,
}: {
  entries: CalendarEntry[];
  todayIso: string;
}) {
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = firstDay.getDay(); // 0=Sun … 6=Sat
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startOffset);
    return Array.from({ length: 42 }).map((_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [monthDate]);

  // Hebrew holidays across the visible 6-week grid (Israel schedule).
  const holidaysByDay = useMemo(
    () => getHolidaysInRange(calendarDays[0], calendarDays[calendarDays.length - 1]),
    [calendarDays]
  );

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

  const selectedEntries = entriesOnDay(selectedDate);
  const prevMonth = () => setMonthDate((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1));
  const nextMonth = () => setMonthDate((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1));
  const goToday = () => { setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(today); };

  return (
    <div className="space-y-4">
      {/* Selected day panel (today by default) — kept on top of the calendar */}
      <div className="rounded-2xl border bg-secondary/10 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold">{fmtFullDay(selectedDate)}</div>
            <div className="text-xs text-muted-foreground">{hebrewFullDate(selectedDate)}</div>
            {holidaysByDay.get(isoLocal(selectedDate)) ? (
              <div className="mt-0.5 text-sm font-medium text-info-soft-foreground">
                {holidaysByDay.get(isoLocal(selectedDate))}
              </div>
            ) : null}
            <div className="text-sm text-muted-foreground">
              {selectedEntries.length > 0
                ? `${selectedEntries.length} פריטים`
                : "אין פריטים ביום זה"}
            </div>
          </div>
          {isToday(selectedDate, today) && <Badge variant="default">היום</Badge>}
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

      {/* Navigation */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={prevMonth}
          className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-secondary/10"
        >
          ›
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{fmtMonthYear(monthDate)}</span>
          <button
            type="button"
            onClick={goToday}
            className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/10"
          >
            היום
          </button>
        </div>
        <button
          type="button"
          onClick={nextMonth}
          className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-secondary/10"
        >
          ‹
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-px rounded-xl border bg-secondary/30 overflow-hidden">
        {calendarDays.map((day) => {
          const inMonth = day.getMonth() === monthDate.getMonth();
          const isToday = isSameDay(day, today);
          const isSelected = isSameDay(day, selectedDate);
          const dayEntries = entriesOnDay(day);
          const taskCount = dayEntries.filter((e) => e.kind === "task").length;
          const reminderCount = dayEntries.filter((e) => e.kind === "reminder").length;
          const projectCount = dayEntries.filter((e) => e.kind === "project").length;
          const holiday = holidaysByDay.get(isoLocal(day)) ?? null;

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setSelectedDate(day)}
              title={holiday ?? undefined}
              className={`flex flex-col items-center gap-0.5 px-1 py-2 transition-colors ${
                holiday ? "bg-info-soft/40" : "bg-background"
              } ${isSelected ? "ring-1 ring-inset ring-primary/40" : "hover:bg-secondary/10"} ${
                !inMonth ? "opacity-35" : ""
              }`}
            >
              {/* Day number (Gregorian) */}
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : isSelected
                      ? "bg-secondary/20 text-secondary font-semibold"
                      : ""
                }`}
              >
                {day.getDate()}
              </span>

              {/* Hebrew day numeral */}
              <span className={`text-[10px] leading-none ${holiday ? "text-info-soft-foreground" : "text-muted-foreground"}`}>
                {hebrewDayLabel(day)}
              </span>

              {/* Holiday name (truncated) */}
              {holiday ? (
                <span className="max-w-full truncate text-[9px] leading-tight text-info-soft-foreground">
                  {holiday}
                </span>
              ) : null}

              {/* Event dots */}
              {(taskCount > 0 || reminderCount > 0 || projectCount > 0) && (
                <div className="flex gap-0.5">
                  {taskCount > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  )}
                  {reminderCount > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-info" />
                  )}
                  {projectCount > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  )}
                </div>
              )}

              {/* Overflow count */}
              {dayEntries.length > 0 && (
                <span className="text-[10px] leading-none text-muted-foreground">
                  {dayEntries.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />משימה</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" />תזכורת</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />פרויקט</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-info-soft" />חג / מועד</span>
      </div>

    </div>
  );
}

function isToday(a: Date, today: Date) {
  return isSameDay(a, today);
}
