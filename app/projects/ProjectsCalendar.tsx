"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AdaptiveStack, AdaptiveWidth } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CalendarEntry } from "@/lib/projectSchedule";

function toDateOnly(value: string | null) {
  if (!value) return null;
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtMonth(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}

function fmtDayNum(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric" }).format(d);
}

function fmtSelectedDay(d: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function entryKindLabel(kind: CalendarEntry["kind"]) {
  return kind === "task" ? "משימה" : "פרויקט";
}

function entryKindVariant(kind: CalendarEntry["kind"]) {
  return kind === "task" ? ("warning" as const) : ("secondary" as const);
}

const weekDays = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

export default function ProjectsCalendar({
  entries,
  todayIso,
}: {
  entries: CalendarEntry[];
  todayIso: string;
}) {
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(2000, 0, 1), [todayIso]);
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = firstDay.getDay();
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startOffset);

    return Array.from({ length: 42 }).map((_, i) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + i);
      return day;
    });
  }, [monthDate]);

  const normalizedEntries = useMemo(
    () =>
      entries
        .map((entry) => ({
          ...entry,
          start: toDateOnly(entry.startDate),
          end: toDateOnly(entry.endDate) ?? toDateOnly(entry.startDate),
        }))
        .filter((entry) => entry.start && entry.end),
    [entries]
  );

  function entriesOnDay(day: Date) {
    return normalizedEntries.filter((entry) => {
      if (!entry.start || !entry.end) return false;
      return day >= entry.start && day <= entry.end;
    });
  }

  const selectedEntries = entriesOnDay(selectedDate);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <AdaptiveStack variant="sectionHeader">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">לוח זמנים</h2>
            <p className="text-sm text-muted-foreground">
              פרויקטים, משימות ואירועים קרובים במקום אחד.
            </p>
          </div>
          <AdaptiveStack variant="calendarToolbar">
            <AdaptiveWidth variant="autoFromSmall">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                }
              >
                חודש קודם
              </Button>
            </AdaptiveWidth>
            <div className="min-w-[9rem] text-center text-sm font-medium">{fmtMonth(monthDate)}</div>
            <AdaptiveWidth variant="autoFromSmall">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                }
              >
                חודש הבא
              </Button>
            </AdaptiveWidth>
            <AdaptiveWidth variant="autoFromSmall">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1));
                  setSelectedDate(today);
                }}
              >
                היום
              </Button>
            </AdaptiveWidth>
          </AdaptiveStack>
        </AdaptiveStack>

        <div className="rounded-2xl border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{fmtSelectedDay(selectedDate)}</div>
              <div className="text-sm text-muted-foreground">
                {selectedEntries.length > 0
                  ? `${selectedEntries.length} פריטים זמינים`
                  : "אין פריטים מתוזמנים ליום הזה"}
              </div>
            </div>
            {isSameDay(selectedDate, today) ? <Badge variant="default">היום</Badge> : null}
          </div>

          <div className="space-y-3">
            {selectedEntries.length > 0 ? (
              selectedEntries.map((entry) => (
                <Link
                  key={`${entry.kind}-${entry.id}`}
                  href={entry.href}
                  className="block rounded-xl border bg-background p-3 transition hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{entry.title}</div>
                    <Badge variant={entryKindVariant(entry.kind)}>{entryKindLabel(entry.kind)}</Badge>
                    {entry.priority ? (
                      <StatusBadge value={entry.priority} type="priority" />
                    ) : null}
                    {entry.status ? (
                      <StatusBadge
                        value={entry.status}
                        type={entry.kind === "task" ? "task" : "project"}
                      />
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{entry.subtitle}</div>
                </Link>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">אין קישורים או משימות להצגה ביום שנבחר.</div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[48rem] space-y-2">
            <div className="grid grid-cols-7 gap-2 text-center text-xs text-muted-foreground">
              {weekDays.map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day) => {
                const inMonth = day.getMonth() === monthDate.getMonth();
                const dayEntries = entriesOnDay(day);
                const isToday = isSameDay(day, today);
                const isSelected = isSameDay(day, selectedDate);

                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    className={`min-h-[144px] rounded-xl border p-2 text-right transition ${
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : inMonth
                          ? "bg-background hover:border-primary/40"
                          : "bg-muted/40 text-muted-foreground hover:border-primary/20"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold ${
                          isToday
                            ? "bg-primary text-primary-foreground"
                            : isSelected
                              ? "bg-primary/10 text-primary"
                              : "bg-transparent"
                        }`}
                      >
                        {fmtDayNum(day)}
                      </span>
                      {isToday ? <span className="text-[11px] font-medium text-primary">היום</span> : null}
                    </div>

                    <div className="space-y-1">
                      {dayEntries.slice(0, 3).map((entry) => (
                        <div
                          key={`${entry.kind}-${entry.id}-${day.toISOString()}`}
                          className={`rounded-lg border px-2 py-1 text-[11px] ${
                            entry.kind === "task"
                              ? "border-warning/30 bg-warning/10"
                              : "border-primary/20 bg-primary/10"
                          }`}
                        >
                          <div className="truncate font-medium">{entry.title}</div>
                          <div className="truncate text-muted-foreground">{entry.subtitle}</div>
                        </div>
                      ))}
                      {dayEntries.length > 3 ? (
                        <div className="text-[11px] text-muted-foreground">+{dayEntries.length - 3} נוספים</div>
                      ) : null}
                      {dayEntries.length === 0 ? (
                        <div className="pt-3 text-[11px] text-muted-foreground">אין פריטים</div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

