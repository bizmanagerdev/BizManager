"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, ChevronRight, ChevronLeft } from "lucide-react";
import type { CalendarEntry, CalendarEntryKind } from "@/lib/projectSchedule";
import {
  hebrewDayLabel,
  hebrewFullDate,
  hebrewParsha,
  getHolidaysInRange,
} from "@/lib/hebrew-calendar";
import {
  isoLocal,
  toDateOnly,
  isSameDay,
  fmtFullDay,
  fmtMonthYear,
} from "@/components/ui/month-calendar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useSetPageTitle } from "@/components/layout/page-title-context";

// ── Event-kind metadata ───────────────────────────────────────────────────────
// Single source of truth for label / plural / color per kind, so the summary
// tiles, grid chips, filter chips and detail list all stay in lockstep. Order
// here drives the tile + chip order (reminder → project → task).
type Kind = CalendarEntryKind;

const KIND_ORDER: Kind[] = ["reminder", "project", "task"];

const KIND_META: Record<
  Kind,
  { label: string; plural: string; dot: string; edge: string }
> = {
  reminder: { label: "תזכורת", plural: "תזכורות", dot: "bg-info", edge: "border-e-info" },
  project: { label: "פרויקט", plural: "פרויקטים", dot: "bg-success", edge: "border-e-success" },
  task: { label: "משימה", plural: "משימות", dot: "bg-warning", edge: "border-e-warning" },
};

const WEEK_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

type Filter = Kind | "all";

type DayEntry = CalendarEntry & { start: Date; end: Date };

// Desktop switches from the slide-up sheet to a persistent side panel. matchMedia
// keeps that decision in state so we never open the (body-portaled) sheet on wide
// screens, where a `lg:hidden` wrapper wouldn't clip it.
function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return desktop;
}

/**
 * The bespoke יומן calendar — its own shell (NOT the shared MonthCalendar): a
 * navy day-summary hero, an RTL Hebrew month grid with per-kind event chips, and
 * a slide-up detail sheet on mobile / persistent side panel on desktop.
 */
export default function CalendarView({
  entries,
  todayIso,
}: {
  entries: CalendarEntry[];
  todayIso: string;
}) {
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  const isDesktop = useIsDesktop();

  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Multi-week projects (a start→end band ≥ 7 days) are dropped — they read as
  // clutter smeared across the grid rather than a dated event.
  const normalized = useMemo<DayEntry[]>(
    () =>
      entries
        .map((e) => {
          const start = toDateOnly(e.startDate);
          const end = toDateOnly(e.endDate) ?? start;
          return start ? { ...e, start, end: end ?? start } : null;
        })
        .filter((e): e is DayEntry => {
          if (!e) return false;
          if (e.kind === "project") {
            const days = (e.end.getTime() - e.start.getTime()) / 86_400_000;
            return days < 7;
          }
          return true;
        }),
    [entries]
  );

  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [month]);

  const holidays = useMemo(
    () => getHolidaysInRange(calendarDays[0], calendarDays[calendarDays.length - 1]),
    [calendarDays]
  );

  function entriesOnDay(day: Date) {
    return normalized.filter((e) => day >= e.start && day <= e.end);
  }

  function selectDay(day: Date) {
    setSelected(day);
    setFilter("all");
    if (!isDesktop) setSheetOpen(true);
  }

  // The summary-card count tiles ARE the filter (incl. an explicit "הכל"). Tapping
  // one filters the day's list to that kind; on mobile it also opens the sheet.
  function pickKind(next: Filter) {
    setFilter(next);
    if (!isDesktop) setSheetOpen(true);
  }

  function stepMonth(delta: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  }

  const onCurrentMonth =
    month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();

  const selectedEntries = entriesOnDay(selected);
  const selectedHoliday = holidays.get(isoLocal(selected))?.name ?? null;

  // The top-bar subtitle reflects the SELECTED day's item count.
  const dayCount = selectedEntries.length;
  useSetPageTitle("יומן", `${dayCount} ${dayCount === 1 ? "פריט" : "פריטים"}`);

  return (
    <div className="space-y-3">
      {/* Mobile: navy day-summary hero above the grid. On desktop it moves INTO the
          side panel (below) so all the day's info lives in one column, matching the
          payments calendar. */}
      <div className="lg:hidden">
        <DaySummaryCard
          day={selected}
          entries={selectedEntries}
          holiday={selectedHoliday}
          isToday={isSameDay(selected, today)}
          filter={filter}
          onPick={pickKind}
        />
      </div>

      {/* Desktop: [month-nav + grid] in the main column beside a full-height day
          panel; mobile: a single stacked column. */}
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          {/* Month navigation */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="חודש קודם"
              className="flex h-9 w-9 items-center justify-center rounded-xl border bg-background text-muted-foreground transition-colors hover:bg-secondary/10"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{fmtMonthYear(month)}</span>
              {!onCurrentMonth && (
                <button
                  type="button"
                  onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
                  className="rounded-lg border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/10"
                >
                  היום
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => stepMonth(1)}
              aria-label="חודש הבא"
              className="flex h-9 w-9 items-center justify-center rounded-xl border bg-background text-muted-foreground transition-colors hover:bg-secondary/10"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          {/* Month grid — full-bleed on phones (counters the page's p-4 gutter) so
              the calendar uses the whole screen width; a bordered card from md up. */}
          <div className="-mx-4 overflow-hidden border-y md:mx-0 md:rounded-2xl md:border">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {WEEK_DAYS.map((d) => (
              <div key={d} className="py-1.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-border">
            {calendarDays.map((day) => {
              const inMonth = day.getMonth() === month.getMonth();
              const isToday = isSameDay(day, today);
              const isSelected = isSameDay(day, selected);
              const info = holidays.get(isoLocal(day));
              const holiday = info?.name ?? null;
              const isMajor = Boolean(info?.major) && inMonth;
              const dayEntries = inMonth ? entriesOnDay(day) : [];

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => selectDay(day)}
                  title={holiday ?? undefined}
                  className={`flex min-h-[4.25rem] flex-col gap-0.5 px-1 py-1.5 text-start transition-colors ${
                    !inMonth
                      ? "bg-muted/20 text-muted-foreground/45"
                      : isMajor
                        ? "bg-muted/40"
                        : "bg-background"
                  } ${isSelected ? "z-10 ring-2 ring-inset ring-secondary" : "hover:bg-secondary/10"}`}
                >
                  <div className="flex w-full items-center justify-between gap-1">
                    <span
                      className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-medium ${
                        isToday ? "bg-primary text-primary-foreground" : ""
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <span className="text-[10px] leading-none text-muted-foreground">
                      {hebrewDayLabel(day)}
                    </span>
                  </div>

                  {holiday ? (
                    <span className="text-[9px] leading-tight text-primary/80">{holiday}</span>
                  ) : null}

                  {/* Colored dots (one per kind present) + a count — no titles, so
                      nothing ever truncates in the narrow cells. Full titles show
                      when the day is opened. */}
                  {dayEntries.length > 0 ? (
                    <div className="mt-auto flex items-center gap-0.5">
                      {KIND_ORDER.filter((k) => dayEntries.some((e) => e.kind === k)).map((k) => (
                        <span key={k} className={`h-1.5 w-1.5 rounded-full ${KIND_META[k].dot}`} />
                      ))}
                      <span className="text-[9px] leading-none text-muted-foreground">
                        {dayEntries.length}
                      </span>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
          </div>
        </div>

        {/* Desktop: full-height day panel beside the grid — navy summary + detail
            in one column, matching the payments calendar. Scrolls internally on
            desktop so a long day list never grows the calendar row. */}
        <aside className="relative hidden min-w-0 lg:block">
          {/* One card: dark-blue summary header seamlessly on top of the light
              detail body (chips + list + add), matching the payments calendar. */}
          <div className="flex flex-col overflow-hidden rounded-2xl border shadow-card lg:absolute lg:inset-0 lg:overflow-y-auto">
            <DaySummaryCard
              embedded
              day={selected}
              entries={selectedEntries}
              holiday={selectedHoliday}
              isToday={isSameDay(selected, today)}
              filter={filter}
              onPick={pickKind}
            />
            <div className="flex-1 bg-card p-4">
              <DayDetail
                day={selected}
                entries={selectedEntries}
                holiday={selectedHoliday}
                filter={filter}
                onFilter={setFilter}
                header={<></>}
                hideFilters
              />
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile: slide-up detail sheet (never opens on desktop — see useIsDesktop) */}
      <DaySheet
        open={sheetOpen && !isDesktop}
        onOpenChange={setSheetOpen}
        day={selected}
        entries={selectedEntries}
        holiday={selectedHoliday}
        filter={filter}
        onFilter={setFilter}
      />
    </div>
  );
}

// ── Navy day-summary hero ──────────────────────────────────────────────────────
function DaySummaryCard({
  day,
  entries,
  holiday,
  isToday,
  filter,
  onPick,
  embedded = false,
}: {
  day: Date;
  entries: DayEntry[];
  holiday: string | null;
  isToday: boolean;
  /** Active filter — the matching count tile lights up. */
  filter: Filter;
  onPick: (filter: Filter) => void;
  /** When true, render as the flat dark header of a combined card (no rounding /
   *  shadow of its own) instead of a standalone hero. */
  embedded?: boolean;
}) {
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(day);
  const parsha = useMemo(() => hebrewParsha(day), [day]);
  const counts = KIND_ORDER.map((kind) => ({
    kind,
    count: entries.filter((e) => e.kind === kind).length,
  }));

  return (
    <div
      className={`bg-sidebar p-3 text-sidebar-foreground ${
        embedded ? "" : "rounded-[1.5rem] shadow-card"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Date (right in RTL) */}
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold leading-none">{day.getDate()}</span>
          <div>
            <div className="text-lg font-semibold leading-tight">{weekday}</div>
            <div className="text-xs text-sidebar-foreground/70">{hebrewFullDate(day)}</div>
          </div>
        </div>

        {/* Today + parsha (left in RTL) — wraps rather than truncating. */}
        <div className="flex min-w-0 flex-col items-end gap-1 text-end">
          {isToday ? (
            <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
              היום
            </span>
          ) : null}
          {(parsha || holiday) && (
            <span className="text-xs leading-tight text-sidebar-foreground/85">
              {[parsha, holiday].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      </div>

      {/* Count tiles ARE the filter — "הכל" plus one per kind; the active one lights up. */}
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <SummaryTile
          active={filter === "all"}
          count={entries.length}
          label="הכל"
          onClick={() => onPick("all")}
        />
        {counts.map(({ kind, count }) => (
          <SummaryTile
            key={kind}
            active={filter === kind}
            count={count}
            label={KIND_META[kind].plural}
            dot={KIND_META[kind].dot}
            onClick={() => onPick(kind)}
          />
        ))}
      </div>
    </div>
  );
}

// A single count tile in the summary header, doubling as a filter button. The
// active tile is light (inverted) so the current filter reads at a glance.
function SummaryTile({
  active,
  count,
  label,
  dot,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  dot?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl px-1 py-1.5 text-center transition-colors ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "bg-white/[0.06] text-sidebar-foreground hover:bg-white/[0.12] active:bg-white/[0.16]"
      }`}
    >
      {/* Dot rides next to the count (not the label) so the label keeps the whole
          tile width and never needs truncating. */}
      <div className="flex items-center justify-center gap-1">
        {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
        <span className="text-lg font-bold leading-none">{count}</span>
      </div>
      <div
        className={`mt-1 text-[10px] leading-tight ${
          active ? "text-muted-foreground" : "text-sidebar-foreground/70"
        }`}
      >
        {label}
      </div>
    </button>
  );
}

// ── Shared detail body (filter chips + item list + add button) ─────────────────
function DayDetail({
  day,
  entries,
  holiday,
  filter,
  onFilter,
  header = null,
  hideFilters = false,
}: {
  day: Date;
  entries: DayEntry[];
  holiday: string | null;
  filter: Filter;
  onFilter: (next: Filter) => void;
  /** Optional header row (used by the sheet, which shows title + close). */
  header?: ReactNode;
  /** Hide the chip filter row — e.g. the desktop panel, where the header count
   *  tiles ARE the filter. */
  hideFilters?: boolean;
}) {
  const shown = filter === "all" ? entries : entries.filter((e) => e.kind === filter);

  // The active filter decides WHAT gets created: on a specific kind, add that
  // kind; on "הכל" (the default), add a task. QuickCreateMenu handles the event.
  const addAction: Kind = filter === "all" ? "task" : filter;
  const addLabel = filter === "all" ? "הוספה ליום זה" : `הוסף ${KIND_META[filter].label}`;

  function addToDay() {
    window.dispatchEvent(
      new CustomEvent("bizh:quick-create", {
        detail: { action: addAction, dueDate: isoLocal(day) },
      })
    );
  }

  return (
    <div className="space-y-3">
      {header ?? (
        <div>
          <div className="font-semibold">{fmtFullDay(day)}</div>
          <div className="text-xs text-muted-foreground">
            {hebrewFullDate(day)} · {entries.length ? `${entries.length} פריטים` : "אין פריטים"}
            {holiday ? ` · ${holiday}` : ""}
          </div>
        </div>
      )}

      {/* Filter chips — hidden where the header count tiles act as the filter */}
      {hideFilters ? null : (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={filter === "all"} onClick={() => onFilter("all")}>
            הכל
          </FilterChip>
          {KIND_ORDER.map((kind) => (
            <FilterChip key={kind} active={filter === kind} dot={KIND_META[kind].dot} onClick={() => onFilter(kind)}>
              {KIND_META[kind].label}
            </FilterChip>
          ))}
        </div>
      )}

      {/* Item list */}
      {shown.length ? (
        <div className="space-y-2">
          {shown.map((entry) => (
            <Link
              key={`${entry.kind}-${entry.id}`}
              href={entry.href}
              className={`block rounded-xl border border-e-2 bg-background p-3 transition-colors hover:border-secondary/40 hover:bg-secondary/5 ${KIND_META[entry.kind].edge}`}
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 font-medium">{entry.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {KIND_META[entry.kind].label}
                </span>
              </div>
              {entry.subtitle ? (
                <div className="mt-0.5 text-xs text-muted-foreground">{entry.subtitle}</div>
              ) : null}
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
          {entries.length ? "אין פריטים מסוג זה" : "אין פריטים ביום זה"}
        </div>
      )}

      {/* Add to this day */}
      <button
        type="button"
        onClick={addToDay}
        className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-secondary/40 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-secondary/5"
      >
        <Plus className="h-4 w-4" />
        {addLabel}
      </button>
    </div>
  );
}

function FilterChip({
  active,
  dot,
  onClick,
  children,
}: {
  active: boolean;
  dot?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "border bg-background text-muted-foreground hover:bg-secondary/10"
      }`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
      {children}
    </button>
  );
}

// ── Mobile slide-up sheet ──────────────────────────────────────────────────────
function DaySheet({
  open,
  onOpenChange,
  day,
  entries,
  holiday,
  filter,
  onFilter,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  day: Date;
  entries: DayEntry[];
  holiday: string | null;
  filter: Filter;
  onFilter: (next: Filter) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85svh] overflow-y-auto rounded-t-[1.5rem] p-5"
      >
        <SheetHeader className="mb-3 text-start">
          <SheetTitle>{fmtFullDay(day)}</SheetTitle>
          <SheetDescription>
            {hebrewFullDate(day)} · {entries.length ? `${entries.length} פריטים` : "אין פריטים"}
            {holiday ? ` · ${holiday}` : ""}
          </SheetDescription>
        </SheetHeader>
        <DayDetail
          day={day}
          entries={entries}
          holiday={holiday}
          filter={filter}
          onFilter={onFilter}
          header={<></>}
        />
      </SheetContent>
    </Sheet>
  );
}
