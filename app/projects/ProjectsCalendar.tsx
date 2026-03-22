"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type CalendarProject = {
  id: string;
  name: string;
  customerName: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

function toDateOnly(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtMonth(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}

function fmtDayNum(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric" }).format(d);
}

const weekDays = ["×", "×‘", "×’", "×“", "×”", "×•", "×©"];

export default function ProjectsCalendar({ projects }: { projects: CalendarProject[] }) {
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const calendarDays = useMemo(() => {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = firstDay.getDay(); // 0=Sunday
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startOffset);

    return Array.from({ length: 42 }).map((_, i) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + i);
      return day;
    });
  }, [monthDate]);

  const projectsWithDates = useMemo(
    () =>
      projects.map((p) => ({
        ...p,
        start: toDateOnly(p.startDate),
        end: toDateOnly(p.endDate) ?? toDateOnly(p.startDate),
      })),
    [projects]
  );

  function projectsOnDay(day: Date) {
    return projectsWithDates.filter((p) => {
      if (!p.start || !p.end) return false;
      return day >= p.start && day <= p.end;
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">×œ×•×— ×–×ž× ×™× ×œ×¤×¨×•×™×§×˜×™×</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() =>
                setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
              }
            >
              ×—×•×“×© ×§×•×“×
            </Button>
            <div className="min-w-[9rem] text-center text-sm font-medium">{fmtMonth(monthDate)}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() =>
                setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
              }
            >
              ×—×•×“×© ×”×‘×
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[42rem] space-y-2">
            <div className="grid grid-cols-7 gap-2 text-center text-xs text-muted-foreground">
              {weekDays.map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day) => {
                const inMonth = day.getMonth() === monthDate.getMonth();
                const dayProjects = projectsOnDay(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[108px] rounded-md border p-2 ${
                      inMonth ? "bg-background" : "bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    <div className="mb-1 text-xs font-medium">{fmtDayNum(day)}</div>
                    <div className="space-y-1">
                      {dayProjects.slice(0, 2).map((p) => (
                        <div
                          key={`${p.id}-${day.toISOString()}`}
                          className="rounded bg-primary/10 px-1.5 py-1 text-[11px]"
                        >
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="truncate text-muted-foreground">{p.customerName}</div>
                        </div>
                      ))}
                      {dayProjects.length > 2 ? (
                        <div className="text-[11px] text-muted-foreground">
                          +{dayProjects.length - 2} × ×•×¡×¤×™×
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
