"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarIcon, SuccessIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { buildWeekView } from "@/lib/dashboard/week";
import { formatToday } from "@/lib/dashboard/greeting";
import type { CalendarEntry } from "@/lib/projectSchedule";

// THE DAY — today's tasks, projects and reminders from the calendar feed, listed
// one by one: these are the things you actually do today. Its sibling card
// (TodayAlertsCard) carries the dated alerts; the two used to be two sections of
// one full-width card and are now a quarter-width card each.
//
// The WHOLE card is one link to the יומן, so there's no button on it and no
// per-row link inside it: the rows are a preview of the day, and every part of
// the card leads to the one place that shows the day in full. (Nested <a>s
// wouldn't be legal HTML anyway.)
//
// The GREETING is this card's header (user, 2026-08-18: "move this text into the
// היום card") — "בוקר טוב, הוכהייזר 👋" as the title, the FULL date
// ("יום שלישי, 18 באוגוסט 2026") as its second line. It used to be the top bar's
// title and subtitle, where it had to be abbreviated because that slot spills
// rather than shrinks; here it has a line of its own. The bar is back to the
// plain "דשבורד" fallback, and the greeting names the day this card lists.
// One header, not two: a "היום" title above a greeting saying the same thing in
// more words was the sentence twice.
//
// This card says its own emptiness out loud ("היום פנוי") rather than
// disappearing when the day is light. That sentence IS the answer on a quiet
// morning, and it's the whole point of the card — which is why, unlike every
// other widget, it renders even with nothing to show.
//
// A client component so "today" is the VIEWER's day: the server runs UTC, so
// between midnight and 03:00 Israel time a server-computed date is yesterday's.

/**
 * A reminder ON a task is not a second thing to do.
 *
 * The calendar feed carries both — the task (due today) and the reminder (fires
 * today), and a task-linked reminder is even titled with its task's subject — so
 * one task with one reminder arrived here as two identical-looking lines, one
 * "משימה" and one "תזכורת". That's right on the calendar page, where they're
 * separate objects you can move independently; on a card that answers "what do I
 * have today" it's the same item twice.
 *
 * So the reminder folds into its task and leaves behind the only part of itself
 * the day needs: the TIME. Reminders that aren't attached to a task (a call to
 * make, a promise to chase) are untouched — they ARE the thing to do.
 */
function foldTaskReminders(entries: CalendarEntry[]): CalendarEntry[] {
  const taskHrefs = new Set(entries.filter((e) => e.kind === "task").map((e) => e.href));
  const timeOfTask = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind !== "reminder" || !taskHrefs.has(entry.href)) continue;
    const time = /(\d{2}:\d{2})/.exec(entry.subtitle ?? "")?.[1];
    if (time) timeOfTask.set(entry.href, time);
  }

  return entries
    .filter((entry) => !(entry.kind === "reminder" && taskHrefs.has(entry.href)))
    .map((entry) => {
      const time = entry.kind === "task" ? timeOfTask.get(entry.href) : undefined;
      if (!time || (entry.subtitle ?? "").includes(time)) return entry;
      return { ...entry, subtitle: [entry.subtitle, time].filter(Boolean).join(" • ") };
    });
}

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

// No reactive source — the greeting is read from the local clock on each render.
const subscribe = () => () => {};

export default function TodayScheduleCard({
  entries,
  initialDate,
}: {
  /** The unified calendar feed (tasks / projects / reminders), all dates. */
  entries: CalendarEntry[];
  /** SSR snapshot of today's date, from the server's clock. */
  initialDate: string;
}) {
  // useSyncExternalStore returns the server snapshot during SSR/hydration and the
  // client value afterwards — no hydration mismatch and no setState-in-effect.
  // The card is named by the DATE now; the greeting moved to the top bar (user,
  // 2026-08-18), where a greeting belongs — it greets the person, not the day.
  const todayLabel = useSyncExternalStore(subscribe, () => formatToday(new Date()), () => initialDate);

  const { todayEntries, ongoing } = useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const view = buildWeekView(entries, midnight);
    return {
      todayEntries: foldTaskReminders(view.days.find((day) => day.isToday)?.entries ?? []),
      // Projects with no single day of their own that are running right now.
      ongoing: view.generalEntries,
    };
  }, [entries]);

  const empty = todayEntries.length === 0 && ongoing.length === 0;

  return (
    // The card leads to the calendar, each row to its own entry. The card's link
    // is a full-bleed overlay rather than a wrapper: a row <Link> nested inside it
    // wouldn't be legal HTML, so the content sits above it with pointer events off
    // and each row turns them back on for itself.
    <Card className="relative flex h-full flex-col">
      <Link
        href="/calendar"
        aria-label="ליומן"
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        {/* No count: the header is a GREETING, and a number beside "צהריים טובים,
            סורוצקין" reads as part of the sentence rather than as how many things
            are on today. The list under it says how many. */}
        <DashboardCardHeader
          icon={CalendarIcon}
          title={todayLabel}
        />

        {/* The board's list style: p-0 content, rows that run edge to edge and
            carry their own padding, hairlines between them — same as the
            deliveries and payments cards. Anything that ISN'T a row (the green
            line, the running-projects chips) keeps a margin of its own. */}
        <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
          {empty ? (
            // A pill that hugs its words, not a full-width panel. Good news is
            // the smallest thing a card has to say — as a block it was the
            // loudest thing on a quiet day.
            <div className="m-3 inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success-soft px-2.5 py-1 text-xs">
              <SuccessIcon className="h-3.5 w-3.5 shrink-0 text-success" />
              <span className="text-success-soft-foreground">היום פנוי</span>
            </div>
          ) : null}

          {/* Running projects: context for the day rather than an item to tick
              off, so they're chips above the list, not rows in it. */}
          {ongoing.length > 0 ? (
            <div className="m-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-muted/40 p-2 text-xs">
              <span className="font-semibold text-muted-foreground">פרויקטים שוטפים:</span>
              {ongoing.map((entry) => (
                <Link key={entry.id} href={entry.href} className="pointer-events-auto">
                  <Badge variant="info-soft">{entry.title}</Badge>
                </Link>
              ))}
            </div>
          ) : null}

          {todayEntries.length > 0 ? (
            <ul className="board-list divide-y">
              {todayEntries.map((entry) => (
                <li
                  key={`${entry.kind}-${entry.id}`}
                  className="relative px-4 py-3 transition-colors hover:bg-secondary/10"
                >
                  {/* Covers the row, so the whole line is the target. */}
                  <Link
                    href={entry.href}
                    aria-label={entry.title}
                    className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {/* ONE line per row, like "המשימות שלי": the kind chip and the
                      subtitle ride BESIDE the title rather than under it. Stacked,
                      an entry with a subtitle was a two-line row next to a
                      one-line neighbour and the column came out ragged. The title
                      takes what's left and truncates; the short parts keep their
                      size (shrink-0). */}
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", KIND_DOT[entry.kind])} />
                    <span className="truncate text-sm font-medium" title={entry.title}>
                      {entry.title}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1 py-px text-xs text-muted-foreground">
                      {KIND_LABEL[entry.kind]}
                    </span>
                    {entry.subtitle ? (
                      <span className="max-w-[7rem] truncate text-xs text-muted-foreground">
                        {entry.subtitle}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Ongoing projects but no dated item: said plainly, since the green
              line above only shows when the card is entirely empty. */}
          {todayEntries.length === 0 && !empty ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">אין משימות או פרויקטים להיום.</p>
          ) : null}
        </CardContent>
        {/* "ליומן", not "כל היומן": the calendar is a place, not a list you see all of. */}
        <DashboardCardFooter href="/calendar" label="ליומן" />
      </div>
    </Card>
  );
}
