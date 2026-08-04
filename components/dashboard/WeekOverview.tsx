"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CalendarEntry } from "@/lib/projectSchedule";
import { buildWeekView } from "@/lib/dashboard/week";

const KIND_DOT: Record<CalendarEntry["kind"], string> = {
  project: "bg-secondary",
  task: "bg-warning",
  reminder: "bg-success",
};

/**
 * "מבט על היום" — today's scheduled items (tasks due, reminders, active projects).
 * The full Sun–Sat week is available from the "מה קורה השבוע" quick-action popup;
 * the dashboard keeps this inline section focused on just today.
 */
export default function WeekOverview({ entries }: { entries: CalendarEntry[] }) {
  const { items, general, todayLabel } = useMemo(() => {
    const now = new Date();
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const view = buildWeekView(entries, todayDate);
    const todayBucket = view.days.find((bucket) => bucket.isToday);
    return {
      items: todayBucket?.entries ?? [],
      general: view.generalEntries,
      todayLabel: new Intl.DateTimeFormat("he-IL", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(todayDate),
    };
  }, [entries]);

  // Match the other dashboard panels: a panel with nothing to show renders nothing,
  // rather than leaving a near-empty card that reads as dead space (esp. on mobile).
  if (items.length === 0 && general.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">מבט על היום</CardTitle>
        </div>
        <div className="text-sm text-muted-foreground">{todayLabel}</div>
      </CardHeader>
      <CardContent className="space-y-2">
        {general.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-2 text-xs">
            <span className="font-semibold text-muted-foreground">פרויקטים שוטפים:</span>
            {general.map((entry) => (
              <Link key={entry.id} href={entry.href} className="hover:underline">
                <Badge variant="info-soft">{entry.title}</Badge>
              </Link>
            ))}
          </div>
        ) : null}

        {items.length > 0 ? (
          items.map((entry) => (
            <Link
              key={`${entry.kind}-${entry.id}`}
              href={entry.href}
              className="flex items-center justify-between gap-2 rounded-xl bg-secondary-10/50 px-3 py-2.5 text-sm transition-colors hover:bg-secondary-10"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", KIND_DOT[entry.kind])} />
                <span className="truncate font-medium">{entry.title}</span>
                {entry.subtitle ? (
                  <span className="truncate text-muted-foreground">— {entry.subtitle}</span>
                ) : null}
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))
        ) : (
          <EmptyState dense>
            אין פריטים מתוכננים להיום.
          </EmptyState>
        )}
      </CardContent>
    </Card>
  );
}
