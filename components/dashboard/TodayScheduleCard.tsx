"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, CalendarIcon, CheckIcon, SuccessIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toHebrewError } from "@/lib/error-messages";
import { offlineFetch } from "@/lib/offline-queue";
import { refreshAlerts } from "@/lib/ui/alerts-store";
import { buildWeekView } from "@/lib/dashboard/week";
import { formatToday } from "@/lib/dashboard/greeting";
import { isoLocal } from "@/components/ui/month-calendar";
import type { CalendarEntry } from "@/lib/projectSchedule";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";

// A row can be resolved in place (task done / reminder done) without leaving
// the card — projects can't (no single "done" for a date range), so they stay
// navigate-only.
function isResolvableKind(kind: CalendarEntry["kind"]): kind is "task" | "reminder" {
  return kind === "task" || kind === "reminder";
}

// THE DAY — today's tasks, projects and reminders from the calendar feed, and
// (2026-08-19) the same tab strip / bordered rows / "הוספה ליום זה" as the
// calendar page's own day panel (app/(app)/calendar/CalendarView.tsx's
// DayDetail) — this IS that panel now, not a compact preview of it, now that
// it's the board's hero card and has the room. Its sibling card
// (TodayAlertsCard) carries the dated alerts.
//
// The CARD is still one link to the יומן (a full-bleed overlay, first child,
// BEHIND the content rather than wrapping it — every interactive piece below
// is a sibling of that overlay, not its descendant, which is what makes
// per-row <Link>s, the filter pills and the add button all legal HTML here:
// none of them nest inside another <a>). Clicking empty space still opens the
// full calendar; clicking a row, a pill, or "הוספה" does its own thing instead.
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

// Same source of truth as the calendar page's own day panel (app/(app)/calendar/
// CalendarView.tsx's KIND_META) — this card IS that panel now, so a kind can't
// wear one color here and another there.
type Kind = CalendarEntry["kind"];
const KIND_ORDER: Kind[] = ["reminder", "project", "task", "delivery"];
// `border` is the full-border color used by the filter pills — red/destructive
// is reserved for urgent/danger elsewhere, so delivery gets purple
// (app/globals.css's --purple-*, the one hue not already claimed by a status).
function kindMeta(
  locale: Locale
): Record<Kind, { label: string; plural: string; dot: string; edge: string; border: string }> {
  return {
    reminder: {
      label: t(dashboardDict, locale, "kindReminder"),
      plural: t(dashboardDict, locale, "kindReminderPlural"),
      dot: "bg-info",
      edge: "border-e-info",
      border: "border-info",
    },
    project: {
      label: t(dashboardDict, locale, "kindProject"),
      plural: t(dashboardDict, locale, "kindProjectPlural"),
      dot: "bg-success",
      edge: "border-e-success",
      border: "border-success",
    },
    task: {
      label: t(dashboardDict, locale, "kindTask"),
      plural: t(dashboardDict, locale, "kindTaskPlural"),
      dot: "bg-warning",
      edge: "border-e-warning",
      border: "border-warning",
    },
    delivery: {
      label: t(dashboardDict, locale, "kindDelivery"),
      plural: t(dashboardDict, locale, "kindDeliveryPlural"),
      dot: "bg-palette-purple-4",
      edge: "border-e-palette-purple-4",
      border: "border-palette-purple-4",
    },
  };
}

// No reactive source — the greeting is read from the local clock on each render.
const subscribe = () => () => {};

export default function TodayScheduleCard({
  entries,
  initialDate,
  locale,
}: {
  /** The unified calendar feed (tasks / projects / reminders), all dates. */
  entries: CalendarEntry[];
  /** SSR snapshot of today's date, from the server's clock. */
  initialDate: string;
  locale: Locale;
}) {
  // useSyncExternalStore returns the server snapshot during SSR/hydration and the
  // client value afterwards — no hydration mismatch and no setState-in-effect.
  // The card is named by the DATE now; the greeting moved to the top bar (user,
  // 2026-08-18), where a greeting belongs — it greets the person, not the day.
  const todayLabel = useSyncExternalStore(subscribe, () => formatToday(new Date(), locale), () => initialDate);
  const KIND_META = kindMeta(locale);
  const router = useRouter();

  const { todayEntries: rawTodayEntries, ongoing } = useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const view = buildWeekView(entries, midnight);
    return {
      todayEntries: foldTaskReminders(view.days.find((day) => day.isToday)?.entries ?? []),
      // Projects with no single day of their own that are running right now.
      ongoing: view.generalEntries,
    };
  }, [entries]);

  // Resolved rows (task done / reminder done) drop out instantly rather than
  // waiting on the router.refresh() below to re-fetch the calendar feed.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(() => new Set());
  const rowKey = (entry: CalendarEntry) => `${entry.kind}-${entry.id}`;
  const todayEntries = useMemo(
    () => rawTodayEntries.filter((entry) => !resolvedKeys.has(rowKey(entry))),
    [rawTodayEntries, resolvedKeys]
  );

  async function resolveEntry(entry: CalendarEntry) {
    if (busyKey) return;
    const key = rowKey(entry);
    setBusyKey(key);
    try {
      if (entry.kind === "task") {
        const result = await offlineFetch(
          "/api/tasks/update-status",
          { id: entry.id, status: "done" },
          t(dashboardDict, locale, "markTaskDoneQueued")
        );
        if (result.queued) {
          setResolvedKeys((prev) => new Set(prev).add(key));
          return;
        }
        if (!result.ok) {
          toast.error(toHebrewError(result.error, t(dashboardDict, locale, "actionFailed")));
          return;
        }
        toast.success(t(dashboardDict, locale, "taskMarkedDone"));
      } else {
        const res = await fetch("/api/reminders/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id, action: "done" }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error);
        toast.success(t(dashboardDict, locale, "reminderMarkedDone"));
      }
      setResolvedKeys((prev) => new Set(prev).add(key));
      refreshAlerts();
      router.refresh();
    } catch (err: unknown) {
      toast.error(toHebrewError(err, t(dashboardDict, locale, "actionFailed")));
    } finally {
      setBusyKey(null);
    }
  }

  const empty = todayEntries.length === 0 && ongoing.length === 0;

  // Same "tab strip" as the calendar's day panel — filters todayEntries in
  // place rather than navigating, since this card has room for the list now.
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const shown = filter === "all" ? todayEntries : todayEntries.filter((entry) => entry.kind === filter);

  // Same door the calendar's own "הוספה ליום זה" uses (see QuickCreateMenu's
  // `bizh:quick-create` listener) — pre-dated to today, kind to whatever's
  // filtered ("all" defaults to a task, same rule as the calendar page).
  function addToday(kind: Kind) {
    window.dispatchEvent(
      new CustomEvent("bizh:quick-create", { detail: { action: kind, dueDate: isoLocal(new Date()) } })
    );
  }
  const addAction: Kind = filter === "all" ? "task" : filter;
  const addLabel =
    filter === "all"
      ? t(dashboardDict, locale, "addToday")
      : `${t(dashboardDict, locale, "addKindPrefix")} ${KIND_META[filter].label}`;

  return (
    // The card leads to the calendar, each row to its own entry. The card's link
    // is a full-bleed overlay rather than a wrapper: a row <Link> nested inside it
    // wouldn't be legal HTML, so the content sits above it with pointer events off
    // and each row turns them back on for itself.
    // No border/fill hardcoded here on purpose — the hero wears EXACTLY ONE of
    // them at a time (a border when the board is crowded, a blue fill when
    // it's sparse; never both, never neither — user: "it shouldn't have a
    // border [with the fill]. when it has no fill, then it needs the
    // border"), decided by FEW_CARDS_THRESHOLD, which isn't known until every
    // OTHER widget's node has resolved too — this card is built as one of
    // them, before that count exists. See HERO_EMPHASIS_FILL_CLASS /
    // HERO_EMPHASIS_BORDER_CLASS in lib/dashboard/widgets.ts, applied at the
    // Cell in DashboardSections.tsx.
    <Card className="relative flex h-full flex-col">
      <Link
        href="/calendar"
        aria-label={t(dashboardDict, locale, "toCalendarLabel")}
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
            line, the running-projects chips) keeps a margin of its own.
            `justify-[safe_center]`: this is the HERO cell now, forced tall to
            match its row — a light day's two rows sat pinned to the top with a
            wall of dead space beneath (user: "it should be centered like the
            calender"). `safe` is what keeps a busy day safe from the opposite
            mistake: plain `justify-center` on an overflowing flex container
            clips equally off BOTH ends once content is taller than the box,
            which would cut off the top of the list, not just leave less
            padding; `safe` falls back to start-alignment (and this card's own
            scroll) the moment there isn't room to center. */}
        <CardContent className="pointer-events-auto flex min-h-0 flex-1 flex-col justify-[safe_center] overflow-y-auto p-0">
          {/* CardContent's own children are now flex items (for the centering
              above), and a flex item's default minimum WIDTH is its content's
              own natural size, not 0 — the "sarah vort thursday night mishkan
              esther" row was wide enough to push a horizontal scrollbar under
              the card. One `min-w-0` wrapper is enough to let everything
              inside shrink/wrap to the card's actual width again. */}
          <div className="min-w-0">
          {empty ? (
            // A pill that hugs its words, not a full-width panel. Good news is
            // the smallest thing a card has to say — as a block it was the
            // loudest thing on a quiet day.
            <div className="m-3 inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success-soft px-2.5 py-1 text-xs">
              <SuccessIcon className="h-3.5 w-3.5 shrink-0 text-success" />
              <span className="text-success-soft-foreground">{t(dashboardDict, locale, "todayFreeLabel")}</span>
            </div>
          ) : null}

          {/* Running projects: context for the day rather than an item to tick
              off, so they're chips above the list, not rows in it. */}
          {ongoing.length > 0 ? (
            <div className="m-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-muted/40 p-2 text-xs">
              <span className="font-semibold text-muted-foreground">{t(dashboardDict, locale, "ongoingProjectsLabel")}</span>
              {ongoing.map((entry) => (
                <Link key={entry.id} href={entry.href} className="pointer-events-auto">
                  <Badge variant="info-soft">{entry.title}</Badge>
                </Link>
              ))}
            </div>
          ) : null}

          {/* The calendar day panel's own tab strip (app/(app)/calendar/
              CalendarView.tsx's FilterToolbar) — filters IN PLACE, since the
              hero card has room for the list now instead of a one-line preview.
              xl only: on a phone this card is back to a compact one-column
              stack, no room to spare for a filter row (user: "the today card
              on mobile shouldn't have the filter") — `filter` just stays "all"
              there, so `shown` is always the full list. */}
          {todayEntries.length > 0 ? (
            <div className="pointer-events-auto m-3 hidden items-center gap-1.5 overflow-x-auto xl:flex xl:flex-nowrap">
              <FilterPill active={filter === "all"} label={t(dashboardDict, locale, "filterAll")} count={todayEntries.length} onClick={() => setFilter("all")} />
              {KIND_ORDER.map((kind) => (
                <FilterPill
                  key={kind}
                  active={filter === kind}
                  label={KIND_META[kind].plural}
                  count={todayEntries.filter((entry) => entry.kind === kind).length}
                  border={KIND_META[kind].border}
                  onClick={() => setFilter(kind)}
                />
              ))}
            </div>
          ) : null}

          {shown.length > 0 ? (
            <ul className="space-y-2 px-3 pb-3">
              {shown.map((entry) => {
                const busy = busyKey === rowKey(entry);
                return (
                  <li
                    key={rowKey(entry)}
                    // Bordered card per row, colored edge per kind — same shape as
                    // the calendar's own day panel, not a compact one-liner: this
                    // card has the width for it now. The border/bg now live on the
                    // li itself, not the Link, so the row can also carry a resolve
                    // button beside the link without nesting a button in an <a>.
                    className={cn(
                      "relative rounded-xl border border-e-2 bg-background transition-colors hover:border-secondary/40 hover:bg-secondary/5",
                      KIND_META[entry.kind].edge
                    )}
                  >
                    {/* Full-row click target, UNSTYLED (transparent) so the li's own
                        border/bg show through — the resolve button below is lifted
                        above it (via `relative`, later in DOM order) to catch its
                        own clicks instead of navigating. */}
                    <Link
                      href={entry.href}
                      aria-label={entry.title}
                      className="pointer-events-auto absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex items-center gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 text-sm font-medium">{entry.title}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{KIND_META[entry.kind].label}</span>
                        </div>
                        {entry.subtitle ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">{entry.subtitle}</div>
                        ) : null}
                      </div>
                      {isResolvableKind(entry.kind) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="pointer-events-auto relative h-7 shrink-0 px-2 text-xs max-md:min-h-[44px]"
                          onClick={() => void resolveEntry(entry)}
                          disabled={busy}
                          title={
                            entry.kind === "task"
                              ? t(dashboardDict, locale, "markTaskDoneTitle")
                              : t(dashboardDict, locale, "markReminderDoneTitle")
                          }
                        >
                          {busy ? <SuccessIcon className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}
                          {t(dashboardDict, locale, "doneButtonLabel")}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {/* Ongoing projects but no dated item: said plainly, since the green
              line above only shows when the card is entirely empty. */}
          {todayEntries.length === 0 && !empty ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t(dashboardDict, locale, "emptyTodayLabel")}</p>
          ) : null}

          {/* "הוספה ליום זה" — the calendar day panel always offers this, empty
              day or not; an empty hero card that can only ever be READ was
              wasting the room this redesign gave it. */}
          <button
            type="button"
            onClick={() => addToday(addAction)}
            // `w-[calc(100%-1.5rem)]` + `mx-3`, not `w-full` + `mx-3` — that combo
            // is what overflowed last time: a fixed 100% width plus margin OUTSIDE
            // it adds up to more than the row has, off by exactly the margin. The
            // calc subtracts the margin back out first, so the two together land
            // on exactly the row's width, same as the bordered rows above it.
            // Sized like the rows above it, not a CTA — beside the rest of the
            // board's compact cards a bigger version read as a mistake, not
            // emphasis (user: "the button is way too big").
            className="pointer-events-auto mx-3 mb-3 flex w-[calc(100%-1.5rem)] items-center justify-center gap-1 rounded-xl border border-dashed border-secondary/40 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-secondary/5"
          >
            <AddIcon className="h-4 w-4" />
            {addLabel}
          </button>
          </div>
        </CardContent>
        {/* "ליומן", not "כל היומן": the calendar is a place, not a list you see all of. */}
        <DashboardCardFooter href="/calendar" label={t(dashboardDict, locale, "toCalendarLabel")} />
      </div>
    </Card>
  );
}

// A labeled filter pill (name + count), same as the calendar page's own —
// an empty kind reads clearly as "0 X" instead of a bare, meaningless zero.
function FilterPill({
  active,
  label,
  count,
  border,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  /** The kind's full-border color class (kindMeta().border) — replaces a dot
   *  so more chips fit in one row. */
  border?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border-2 px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-secondary bg-secondary/10 text-secondary"
          : cn(border ?? "border-border", "bg-background text-muted-foreground hover:bg-secondary/5")
      )}
    >
      <span>{label}</span>
      <span className="font-bold">{count}</span>
    </button>
  );
}
