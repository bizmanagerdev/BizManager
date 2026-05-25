"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AlertsTimeline from "@/app/alerts/AlertsTimeline";
import ProjectsCalendar from "@/app/projects/ProjectsCalendar";
import type { CalendarEntry } from "@/lib/projectSchedule";

export default function CalendarSection({
  entries,
  todayIso,
}: {
  entries: CalendarEntry[];
  todayIso: string;
}) {
  const [view, setView] = useState<"timeline" | "calendar">("timeline");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">לוח אירועים</CardTitle>
          <div className="flex rounded-xl border bg-secondary/40 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setView("timeline")}
              className={`rounded-lg px-3 py-1 transition-colors ${
                view === "timeline"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40"
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
                  : "text-muted-foreground hover:bg-muted/40"
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
            <div className="mb-3 flex gap-3 text-xs text-muted-foreground">
              <LegendDot color="bg-warning" label="משימה" />
              <LegendDot color="bg-success" label="פרויקט מתחיל" />
              <LegendDot color="bg-destructive" label="פרויקט מסתיים" />
            </div>
            <AlertsTimeline entries={entries} todayIso={todayIso} days={21} />
          </>
        ) : (
          <ProjectsCalendar entries={entries} todayIso={todayIso} />
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
