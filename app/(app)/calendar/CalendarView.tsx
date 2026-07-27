"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, MoreVertical } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

const WEEK_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

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
  allEntries = null,
  todayIso,
}: {
  entries: CalendarEntry[];
  /** When provided (admin/office), the header שלי/הכל menu is shown. */
  allEntries?: CalendarEntry[] | null;
  todayIso: string;
}) {
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  const isDesktop = useIsDesktop();

  // Scope (שלי/הכל) — chosen from the header ⋮ menu; only offered when the caller
  // supplied everyone's entries.
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const canToggleScope = allEntries !== null;
  const shownEntries = scope === "all" && allEntries ? allEntries : entries;

  const [selected, setSelected] = useState(today);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  // One month on screen at a time; a scroll / swipe steps to the next or previous
  // month. Always opens on the current month. `navDir` drives the slide direction.
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [navDir, setNavDir] = useState<"next" | "prev">("next");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Two-finger pinch scales ONLY the calendar text/boxes (not the page). Held in a
  // ref too so the gesture handler reads the live value without re-subscribing.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);

  // Multi-week projects (a start→end band ≥ 7 days) are dropped — they read as
  // clutter smeared across the grid rather than a dated event.
  const normalized = useMemo<DayEntry[]>(
    () =>
      shownEntries
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
    [shownEntries]
  );

  const entriesOnDay = useMemo(
    () => (day: Date) => normalized.filter((e) => day >= e.start && day <= e.end),
    [normalized]
  );

  // A transient month label flashed right after a page change, then hidden. Driven
  // from the paging actions (not a [month] effect) to avoid set-state-in-effect.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPeek = useCallback(() => {
    setPeek(true);
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(false), 1400);
  }, []);
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    []
  );

  const scrollToToday = useCallback(() => {
    setNavDir("prev");
    setSelected(today);
    setFilter("all");
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    showPeek();
  }, [today, showPeek]);

  // Header carries a jump-to-today button, so listen for its event.
  useEffect(() => {
    const onToday = () => scrollToToday();
    window.addEventListener("bizh:calendar-today", onToday);
    return () => window.removeEventListener("bizh:calendar-today", onToday);
  }, [scrollToToday]);

  // Adding from inside the day sheet: close the sheet so the create dialog opens
  // ON TOP of the page instead of hidden behind the sheet.
  useEffect(() => {
    const onQuick = () => setSheetOpen(false);
    window.addEventListener("bizh:quick-create", onQuick);
    return () => window.removeEventListener("bizh:quick-create", onQuick);
  }, []);

  // Gestures on the calendar: a two-finger pinch zooms the cells; a one-finger
  // vertical swipe (or a wheel notch) steps the month — but only while the content
  // isn't scrollable (i.e. not zoomed past the frame), so a zoomed month can pan.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let pinchDist = 0;
    let pinchZoom = 1;
    let swipeY: number | null = null;
    let wheelAcc = 0;
    let lastStep = 0;

    const step = (delta: number) => {
      const now = performance.now();
      if (now - lastStep < 250) return;
      lastStep = now;
      setNavDir(delta > 0 ? "next" : "prev");
      setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
      showPeek();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchDist = dist(e.touches);
        pinchZoom = zoomRef.current;
        swipeY = null;
      } else if (e.touches.length === 1) {
        swipeY = e.touches[0].clientY;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchDist > 0) {
        e.preventDefault();
        const next = Math.min(1.8, Math.max(0.7, (pinchZoom * dist(e.touches)) / pinchDist));
        zoomRef.current = next;
        setZoom(next);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0 && swipeY != null) {
        const dy = (e.changedTouches[0]?.clientY ?? swipeY) - swipeY;
        if (Math.abs(dy) > 40) step(dy < 0 ? 1 : -1); // swipe up → next month
      }
      if (e.touches.length < 2) pinchDist = 0;
      if (e.touches.length === 0) swipeY = null;
    };
    const onWheel = (e: WheelEvent) => {
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) > 60) {
        step(wheelAcc > 0 ? 1 : -1);
        wheelAcc = 0;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [showPeek]);

  // Tapping a day only SELECTS it (updates the date row + counts). The day's list
  // pops up only when a filter chip is tapped (see pickKind).
  function selectDay(day: Date) {
    setSelected(day);
    setFilter("all");
  }

  // Tapping a filter chip (הכל / a kind) opens the day sheet, filtered to it.
  function pickKind(next: Filter) {
    setFilter(next);
    if (!isDesktop) setSheetOpen(true);
  }

  const selectedEntries = entriesOnDay(selected);
  const selectedHoliday = useMemo(
    () => getHolidaysInRange(selected, selected).get(isoLocal(selected))?.name ?? null,
    [selected]
  );
  const selectedParsha = useMemo(() => hebrewParsha(selected), [selected]);

  const hebShort = hebrewFullDate(selected).replace(/\s+\S+$/, "");
  // Header subtitle = the VIEWED month (Gregorian + Hebrew), updating as you page.
  const hebMonth = useMemo(
    () => hebrewFullDate(new Date(month.getFullYear(), month.getMonth(), 15)).replace(/^\S+\s/, ""),
    [month]
  );
  // A single ⋮ menu in the header (jump-to-today + scope) — one icon keeps the
  // title uncramped so the full month + Hebrew year shows without truncating.
  const headerAction = useMemo(
    () => <HeaderMenu canToggleScope={canToggleScope} scope={scope} onScope={setScope} />,
    [canToggleScope, scope]
  );
  // Hebrew month + year only, so it always fits the header with no ellipsis (the
  // full Gregorian + Hebrew shows in the paging peek).
  useSetPageTitle("יומן", hebMonth, headerAction);

  return (
    // Cancel the app shell's bottom padding on this page so the calendar can fill
    // to the bottom nav without the page itself ever scrolling.
    <div className="-mb-24 space-y-3 md:mb-0">
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Mobile: a fixed-height flex column (chrome above + bottom nav reserved)
            so the calendar flex-child fills exactly — no bottom gap, no page
            scroll. Desktop: normal flow beside the side panel. */}
        <div className="flex h-[calc(100dvh-9.25rem)] min-w-0 flex-col md:block md:h-auto">
          {/* Selected-day date (Gregorian + Hebrew) + the labeled count filters. */}
          <div className="-mx-4 shrink-0 space-y-1.5 border-b bg-background px-2 py-1.5 lg:hidden">
            <div className="flex items-baseline justify-between gap-2 px-1 text-xs">
              <span className="font-semibold text-foreground">{fmtFullDay(selected)}</span>
              <span className="text-muted-foreground">{hebrewFullDate(selected)}</span>
            </div>
            <FilterToolbar entries={selectedEntries} filter={filter} onPick={pickKind} />
          </div>

          {/* One month at a time — a scroll / swipe steps to the next or previous
              month (no arrows). Full-bleed on phones, a bordered card from md up. */}
          <div
            ref={scrollRef}
            className="relative -mx-4 min-h-0 flex-1 touch-none overflow-hidden border-b md:mx-0 md:h-[calc(100vh-11rem)] md:flex-none md:rounded-2xl md:border md:border-t"
          >
            {/* Transient "which month" label — shows on a page change, then fades. */}
            {peek ? (
              <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex animate-in fade-in-0 justify-center">
                <span className="rounded-full bg-sidebar/90 px-3 py-1 text-xs font-semibold text-sidebar-foreground shadow-lg backdrop-blur">
                  {fmtMonthYear(month)} · {hebMonth}
                </span>
              </div>
            ) : null}

            {/* Pinch scales only the cell text (em-based), so the month grid stays
                fixed and a full month is always in view. */}
            <div style={{ fontSize: `${zoom}rem` }} className="h-full">
              <div
                key={`${month.getFullYear()}-${month.getMonth()}`}
                className={`h-full animate-in fade-in-0 duration-200 ${
                  navDir === "next" ? "slide-in-from-bottom-3" : "slide-in-from-top-3"
                }`}
              >
                <MonthBlock
                  month={month}
                  today={today}
                  selected={selected}
                  onSelect={selectDay}
                  entriesOnDay={entriesOnDay}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Desktop: full-height day panel beside the grid. Light header (day +
            filters) over the detail list — no dark card. */}
        <aside className="relative hidden min-w-0 lg:block">
          <div className="flex flex-col overflow-hidden rounded-2xl border shadow-card lg:absolute lg:inset-0 lg:overflow-y-auto">
            <div className="border-b bg-secondary/5 px-4 py-3">
              <div className="mb-2">
                <div className="font-semibold">{fmtFullDay(selected)}</div>
                <div className="text-xs text-muted-foreground">
                  {hebShort}
                  {selectedParsha ? ` · ${selectedParsha}` : ""}
                  {selectedHoliday ? ` · ${selectedHoliday}` : ""}
                </div>
              </div>
              <FilterToolbar entries={selectedEntries} filter={filter} onPick={setFilter} />
            </div>
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

// ── Header ⋮ menu: jump to today + choose the scope (my items vs everyone's) ────
function HeaderMenu({
  canToggleScope,
  scope,
  onScope,
}: {
  canToggleScope: boolean;
  scope: "mine" | "all";
  onScope: (next: "mine" | "all") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="אפשרויות"
          className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-white/10"
        >
          <MoreVertical className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-right">
        <DropdownMenuItem
          onSelect={() => window.dispatchEvent(new CustomEvent("bizh:calendar-today"))}
        >
          היום
        </DropdownMenuItem>
        {canToggleScope ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>הצגה</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={scope} onValueChange={(v) => onScope(v as "mine" | "all")}>
              <DropdownMenuRadioItem value="mine">שלי</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="all">הכל</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── One month: weekday row + day grid ──────────────────────────────────────────
function MonthBlock({
  month,
  today,
  selected,
  onSelect,
  entriesOnDay,
}: {
  month: Date;
  today: Date;
  selected: Date;
  onSelect: (day: Date) => void;
  entriesOnDay: (day: Date) => DayEntry[];
}) {
  // Only render the weeks this month actually spans (5 or 6) — so a month that
  // fits in 5 weeks doesn't tack on a whole extra week of the next month.
  const { calendarDays, weeks } = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const firstOffset = first.getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((firstOffset + daysInMonth) / 7);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - firstOffset);
    const calendarDays = Array.from({ length: weeks * 7 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
    return { calendarDays, weeks };
  }, [month]);

  const holidays = useMemo(
    () => getHolidaysInRange(calendarDays[0], calendarDays[calendarDays.length - 1]),
    [calendarDays]
  );

  return (
    // Fills the parent so a whole month is on screen at once — the week-rows share
    // the leftover height. The month name lives in the app header (no month bar).
    <section className="flex h-full flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b bg-muted text-center text-[10px] font-medium text-muted-foreground">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="overflow-hidden whitespace-nowrap px-0.5 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Days fill the remaining height as equal rows, so the month always fits. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7 gap-px bg-border"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {calendarDays.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const isToday = isSameDay(day, today);
          const isSelected = isSameDay(day, selected);
          const info = holidays.get(isoLocal(day));
          const holiday = info?.name ?? null;
          const isMajor = Boolean(info?.major) && inMonth;
          const dayEntries = inMonth ? entriesOnDay(day) : [];
          // On each Shabbat, name the week's parsha (bare name, no "פרשת" prefix).
          const parsha =
            inMonth && day.getDay() === 6
              ? hebrewParsha(day)?.replace(/^פרשת\s+/, "") ?? null
              : null;

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(day)}
              title={holiday ?? undefined}
              className={`relative flex flex-col gap-px overflow-hidden rounded px-0.5 pb-[1em] pt-[1.35em] text-start transition-colors ${
                !inMonth
                  ? "bg-muted/10 text-muted-foreground/70"
                  : isMajor
                    ? "bg-muted/40"
                    : "bg-background"
              } ${isSelected ? "z-10 ring-2 ring-inset ring-secondary" : "hover:bg-secondary/10"}`}
            >
              {/* English date — top-right corner. Text sizes are `em` so a pinch
                  scales only the text, never the fixed box. */}
              <span
                className={`absolute start-0.5 top-0.5 rounded-full px-1 text-[0.72em] font-medium leading-none ${
                  isToday ? "bg-primary py-0.5 text-primary-foreground" : ""
                }`}
              >
                {day.getDate()}
              </span>

              {/* Hebrew date — bottom-left corner */}
              <span className="absolute bottom-0.5 end-1 text-[0.6em] leading-none text-muted-foreground">
                {hebrewDayLabel(day)}
              </span>

              {/* Holiday / Shabbat parsha, then the day's items by title (as many as
                  fit — the cell clips the overflow, no ellipsis). */}
              {holiday ? (
                <span className="overflow-hidden whitespace-nowrap text-[0.55em] font-medium leading-tight text-primary/80">
                  {holiday}
                </span>
              ) : parsha ? (
                <span className="overflow-hidden whitespace-nowrap text-[0.55em] leading-tight text-muted-foreground">
                  {parsha}
                </span>
              ) : null}

              {dayEntries.map((e) => (
                <span
                  key={`${e.kind}-${e.id}`}
                  className="flex items-center gap-0.5 overflow-hidden whitespace-nowrap text-[0.52em] leading-tight text-foreground/80"
                >
                  <span className={`h-1 w-1 shrink-0 rounded-full ${KIND_META[e.kind].dot}`} />
                  <span className="min-w-0 flex-1 overflow-hidden">{e.title}</span>
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── The day's count filters, in one narrow non-wrapping row (today lives in the
// month bar, so this row is purely the filters). ───────────────────────────────
function FilterToolbar({
  entries,
  filter,
  onPick,
}: {
  entries: DayEntry[];
  filter: Filter;
  onPick: (filter: Filter) => void;
}) {
  const counts = KIND_ORDER.map((kind) => ({
    kind,
    count: entries.filter((e) => e.kind === kind).length,
  }));
  return (
    <div className="flex flex-nowrap items-center justify-between gap-1 overflow-x-auto">
      <FilterPill active={filter === "all"} label="הכל" count={entries.length} onClick={() => onPick("all")} />
      {counts.map(({ kind, count }) => (
        <FilterPill
          key={kind}
          active={filter === kind}
          label={KIND_META[kind].plural}
          count={count}
          dot={KIND_META[kind].dot}
          onClick={() => onPick(kind)}
        />
      ))}
    </div>
  );
}

// A labeled filter pill (name + count) so an empty kind reads clearly as "0 X"
// instead of a bare, meaningless zero.
function FilterPill({
  active,
  label,
  count,
  dot,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  dot?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-secondary bg-secondary/10 text-secondary"
          : "border-border bg-background text-muted-foreground hover:bg-secondary/5"
      }`}
    >
      {dot ? <span className={`h-2 w-2 rounded-full ${dot}`} /> : null}
      <span>{label}</span>
      <span className="font-bold">{count}</span>
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
