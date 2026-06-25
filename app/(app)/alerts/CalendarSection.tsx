"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AlertsTimeline from "@/app/(app)/alerts/AlertsTimeline";
import ProjectsCalendar from "@/app/(app)/projects/ProjectsCalendar";
import type { CalendarEntry } from "@/lib/projectSchedule";

export default function CalendarSection({
  entries,
  allEntries = null,
  todayIso,
}: {
  entries: CalendarEntry[];
  /** When provided (admin/office), enables the שלי/הכל scope toggle. */
  allEntries?: CalendarEntry[] | null;
  todayIso: string;
}) {
  const [view, setView] = useState<"timeline" | "calendar">("calendar");
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const canToggleScope = allEntries !== null;
  const shownEntries = scope === "all" && allEntries ? allEntries : entries;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">לוח אירועים</CardTitle>
            {canToggleScope ? (
              <div className="flex rounded-xl border bg-secondary/40 p-0.5 text-sm">
                <button
                  type="button"
                  onClick={() => setScope("mine")}
                  className={`rounded-lg px-3 py-1 transition-colors ${
                    scope === "mine"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary/10"
                  }`}
                >
                  שלי
                </button>
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={`rounded-lg px-3 py-1 transition-colors ${
                    scope === "all"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary/10"
                  }`}
                >
                  הכל
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex rounded-xl border bg-secondary/40 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setView("timeline")}
              className={`rounded-lg px-3 py-1 transition-colors ${
                view === "timeline"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary/10"
              }`}
            >
              ציר זמן
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={`rounded-lg px-3 py-1 transition-colors ${
                view === "calendar"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary/10"
              }`}
            >
              לוח חודשי
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {view === "timeline" ? (
          <>
            <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <LegendDot color="bg-warning" label="משימה" />
              <LegendDot color="bg-info" label="תזכורת" />
              <LegendDot color="bg-success" label="פרויקט מתחיל" />
              <LegendDot color="bg-destructive" label="פרויקט מסתיים" />
            </div>
            <AlertsTimeline entries={shownEntries} todayIso={todayIso} days={21} />
          </>
        ) : (
          <ProjectsCalendar entries={shownEntries} todayIso={todayIso} />
        )}
      </CardContent>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
