"use client";

import { useEffect, useState } from "react";
import type { ActivityToday } from "@/lib/activity/today";
import { israelParts } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// "היום בעסק" — the day at a glance, at the top of the activity page: how the
// day's actions spread over its hours. The four numbers that sat above it
// (money in, new orders, tasks done, hours worked) were taken off (owner,
// 2026-10-21: "not interesting, not needed … just keep the activity bar"), and
// it shares one compact card with "מי עובד עכשיו" (ActivityClient).

/** The hours a day's ribbon spans: the working day, stretched to the day's first and last action and to now. */
export function ribbonHours(hourly: number[], nowHour: number | null): number[] {
  let first = 7;
  let last = 18;
  hourly.forEach((n, h) => {
    if (n > 0) {
      first = Math.min(first, h);
      last = Math.max(last, h);
    }
  });
  if (nowHour !== null) {
    first = Math.min(first, nowHour);
    last = Math.max(last, nowHour);
  }
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

const pad = (h: number) => String(h).padStart(2, "0");
// "14:00 עד 15:00", not "14:00–15:00": between two times, only a word keeps
// right-to-left text from printing them the other way round.
const span = (h: number) => `${pad(h)}:00 עד ${pad((h + 1) % 24)}:00`;

function peakHour(hourly: number[], hours: number[]): number {
  return hours.reduce((best, h) => ((hourly[h] ?? 0) > (hourly[best] ?? 0) ? h : best), hours[0]);
}

/** "השעה העמוסה: 09:00 עד 10:00 · 50 פעולות", or that nothing happened yet. */
export function busiestHourSummary(hourly: number[], nowHour: number | null): string {
  const peak = peakHour(hourly, ribbonHours(hourly, nowHour));
  return (hourly[peak] ?? 0) > 0 ? `השעה העמוסה: ${span(peak)} · ${hourly[peak]} פעולות` : "עוד לא היו פעולות היום";
}

export function HourRibbon({
  hourly,
  nowHour,
  size = "md",
}: {
  hourly: number[];
  nowHour: number | null;
  size?: "sm" | "md";
}) {
  const hours = ribbonHours(hourly, nowHour);
  const max = Math.max(1, ...hours.map((h) => hourly[h] ?? 0));
  const peak = peakHour(hourly, hours);

  return (
    <div>
      {/* Hours run right to left, the way Hebrew reads (and the week runs in the calendar). */}
      <div
        role="img"
        aria-label={busiestHourSummary(hourly, nowHour)}
        className={cn("flex items-end gap-[3px]", size === "md" ? "h-10" : "h-8")}
      >
        {hours.map((h) => {
          const n = hourly[h] ?? 0;
          const isNow = h === nowHour;
          const future = nowHour !== null && h > nowHour;
          return (
            <div
              key={h}
              title={`${span(h)} · ${n} פעולות`}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <div
                className={cn(
                  "w-full rounded-t-[3px] transition-[height] duration-500",
                  future
                    ? "bg-muted"
                    : isNow
                      ? "bg-secondary"
                      : h === peak && n > 0
                        ? "bg-accentSky-6"
                        : "bg-accentSky-8"
                )}
                style={{ height: n > 0 ? `${Math.max(8, (n / max) * 100)}%` : "2px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px] text-[0.588rem] tabular-nums text-muted-foreground">
        {hours.map((h) => (
          <span key={h} className={cn("min-w-0 flex-1 text-center", h === nowHour && "font-semibold text-secondary")}>
            {h === nowHour ? "עכשיו" : h % 3 === 0 ? pad(h) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The current hour on an Israeli clock, kept fresh while the page stays open. */
export function useIsraelHour(): number | null {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setHour(israelParts(new Date()).hour);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return hour;
}

export default function TodayPulse({ today, live, className }: { today: ActivityToday; live: boolean; className?: string }) {
  const nowHour = useIsraelHour();

  return (
    <div className={cn("min-w-0", className)} role="group" aria-label="היום בעסק">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          היום בעסק
          <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground" title="מתעדכן לבד">
            <span className="relative flex h-2 w-2">
              {live ? (
                <span className="absolute inline-flex h-full w-full rounded-full bg-success-soft-foreground/60 motion-safe:animate-ping" />
              ) : null}
              <span className={cn("relative inline-flex h-2 w-2 rounded-full", live ? "bg-success-soft-foreground" : "bg-muted-foreground/50")} />
            </span>
            {live ? "חי" : "מתחבר…"}
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">{busiestHourSummary(today.hourly, nowHour)}</span>
      </div>

      <HourRibbon hourly={today.hourly} nowHour={nowHour} />
    </div>
  );
}
