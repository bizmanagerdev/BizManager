"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronLeftIcon, SuccessIcon } from "@/components/ui/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildWeekView } from "@/lib/dashboard/week";
import type { CalendarEntry } from "@/lib/projectSchedule";
import type { TodayAlert, WorklistSeverity } from "@/lib/reminders/worklist";

// The morning landing, in two parts and in this order:
//   1. THE DAY — today's tasks, projects and reminders from the calendar feed.
//      Listed one by one: these are the things you actually do today.
//   2. DORESH TIPUL — the dated alerts, GROUPED to one line per kind
//      ("צ׳קים להפקדה: 5"). Never itemised: five near-identical cheque rows made
//      a quiet day look like a heavy one.
//
// Part 1 says its own emptiness out loud ("אין משימות או פרויקטים להיום") rather
// than letting part 2 slide up and become the card. That sentence IS the answer
// on a light day, and it's the whole point of the card.
//
// A client component so "today" is the VIEWER's day: the server runs UTC, so
// between midnight and 03:00 Israel time a server-computed date is yesterday's.

const DOT: Record<WorklistSeverity, string> = {
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-muted-foreground/40",
};

const KIND_DOT: Record<CalendarEntry["kind"], string> = {
  project: "bg-secondary",
  task: "bg-warning",
  reminder: "bg-success",
};

const KIND_LABEL: Record<CalendarEntry["kind"], string> = {
  project: "פרויקט",
  task: "משימה",
  reminder: "תזכורת",
};

export default function TodayCard({
  entries,
  alerts,
  rest,
}: {
  /** The unified calendar feed (tasks / projects / reminders), all dates. */
  entries: CalendarEntry[];
  /** Already grouped server-side to one line per rule — see todaySlice. */
  alerts: TodayAlert[];
  /** Open inbox rows this card doesn't stand for, for the tail link. */
  rest: number;
}) {
  const { todayEntries, ongoing, todayLabel } = useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const view = buildWeekView(entries, midnight);
    return {
      todayEntries: view.days.find((day) => day.isToday)?.entries ?? [],
      // Projects with no single day of their own that are running right now.
      ongoing: view.generalEntries,
      todayLabel: new Intl.DateTimeFormat("he-IL", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(midnight),
    };
  }, [entries]);

  const nothingAtAll = todayEntries.length === 0 && ongoing.length === 0 && alerts.length === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-lg">היום</CardTitle>
          <p className="text-xs text-muted-foreground">{todayLabel}</p>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href="/inbox">התיבה</Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-1.5">
        {nothingAtAll ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success-soft px-3 py-3 text-sm">
            <SuccessIcon className="h-4 w-4 shrink-0 text-success" />
            <span className="text-success-soft-foreground">היום פנוי — אין משימות, פרויקטים או תשלומים.</span>
          </div>
        ) : null}

        {/* Running projects: context for the day rather than an item to tick off,
            so they're chips above the list, not rows in it. */}
        {ongoing.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-2 text-xs">
            <span className="font-semibold text-muted-foreground">פרויקטים שוטפים:</span>
            {ongoing.map((entry) => (
              <Link key={entry.id} href={entry.href} className="hover:underline">
                <Badge variant="info-soft">{entry.title}</Badge>
              </Link>
            ))}
          </div>
        ) : null}

        {todayEntries.map((entry) => (
          <Link
            key={`${entry.kind}-${entry.id}`}
            href={entry.href}
            className="flex items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", KIND_DOT[entry.kind])} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{entry.title}</span>
              <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <span className="rounded bg-muted px-1 py-px">{KIND_LABEL[entry.kind]}</span>
                {entry.subtitle ? <span>{entry.subtitle}</span> : null}
              </span>
            </span>
            <ChevronLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}

        {/* Said plainly, and only when there IS something else on the card — with
            an empty card the success line above already covers it. */}
        {todayEntries.length === 0 && !nothingAtAll ? (
          <p className="px-1 py-1 text-sm text-muted-foreground">אין משימות או פרויקטים להיום.</p>
        ) : null}

        {alerts.length > 0 ? (
          <div className="space-y-1.5 pt-2">
            <div className="px-1 text-xs font-semibold text-muted-foreground">דורש טיפול</div>
            {alerts.map((alert) => (
              <Link
                key={alert.id}
                href={alert.href}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
              >
                <span className="flex items-center gap-2.5">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[alert.severity] ?? DOT.info)} />
                  <span className="text-sm font-medium">{alert.title}</span>
                </span>
                <ChevronLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        ) : null}

        {rest > 0 ? (
          <Link href="/inbox" className="block px-1 pt-1 text-xs text-muted-foreground hover:underline">
            ועוד {rest} בתיבה
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
