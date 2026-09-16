"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { hebrewDayLabel, getHolidaysInRange } from "@/lib/hebrew-calendar";

// ── Shared date helpers ───────────────────────────────────────────────────────
export function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function toDateOnly(value: string | null) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function fmtMonthYear(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}
export function fmtFullDay(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(d);
}

const WEEK_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

// Reusable month-navigation group: ‹ month year › + היום. The caller places it
// inside its own toolbar so it controls the order of the other controls.
export function MonthNav({
  month,
  todayDate,
  onChange,
  labelClassName = "text-sm font-semibold",
}: {
  month: Date;
  todayDate: Date;
  onChange: (next: Date) => void;
  /** Size/weight of the month name (callers that make it the grid's title go bolder). */
  labelClassName?: string;
}) {
  const onCurrent = month.getFullYear() === todayDate.getFullYear() && month.getMonth() === todayDate.getMonth();
  const step = (delta: number) => onChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="חודש קודם"
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-secondary/10"
      >
        ‹
      </button>
      <span className={`min-w-[7rem] text-center ${labelClassName}`}>{fmtMonthYear(month)}</span>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="חודש הבא"
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-secondary/10"
      >
        ›
      </button>
      <button
        type="button"
        onClick={() => onChange(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1))}
        disabled={onCurrent}
        className="h-[34px] rounded-lg border bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/10 disabled:opacity-40"
      >
        היום
      </button>
    </div>
  );
}

export type DayContext = {
  day: Date;
  holiday: string | null;
  isToday: boolean;
  isSelected: boolean;
  inMonth: boolean;
};

export type SelectedContext = {
  day: Date;
  holiday: string | null;
  isToday: boolean;
};

type Props = {
  todayIso: string;
  /** Optional controlled month (first of the month). When set with onMonthChange,
   *  the caller owns the visible month (e.g. to keep a list view in sync). */
  month?: Date;
  onMonthChange?: (next: Date) => void;
  /** Hide the built-in month-nav row — the caller renders its own (e.g. a shared
   *  toolbar). Requires controlled `month`/`onMonthChange`. */
  hideNav?: boolean;
  /** Optional controlled selected day. When set with onSelect, the caller owns
   *  the selection (e.g. to jump to a specific day from an external list). */
  selected?: Date;
  onSelect?: (day: Date) => void;
  /** When true, the desktop side panel is pinned to the calendar's height (its
   *  content absolutely fills the column) so a long panel scrolls internally
   *  instead of growing the row. Off by default (ProjectsCalendar unaffected). */
  fixedPanel?: boolean;
  /** Toolbar rendered at the top of the calendar (main) column, above the grid —
   *  so the selected-day side panel rises to the same top edge. */
  toolbar?: ReactNode;
  /** Panel beside the calendar (desktop) / below it (mobile) showing the selected day. */
  renderSelectedPanel: (ctx: SelectedContext) => ReactNode;
  /** Dots / amount / count rendered under each day cell (after day number + Hebrew numeral). */
  renderDayContent: (ctx: DayContext) => ReactNode;
  /**
   * Optional hover popover content for a day cell (desktop). Return null/undefined
   * for days that have nothing to show. Rendered in a floating panel anchored to
   * the hovered cell — the same detail the selected-day panel shows, on hover.
   */
  renderDayHover?: (ctx: DayContext) => ReactNode;
  /** Optional slot between the month-nav row and the grid (e.g. month total + toggles). */
  renderToolbar?: (monthDate: Date) => ReactNode;
  /** Legend row — a key to the grid's marks. */
  legend?: ReactNode;
  /** "below" (default): under the grid. "above": in a header strip INSIDE the
   *  calendar's border, on the weekday header — where the eye meets the marks. */
  legendPlacement?: "above" | "below";
  /** Controls that shape what the grid shows (e.g. filters), rendered at the
   *  start of that same in-border header strip, opposite an "above" legend. */
  gridHeader?: ReactNode;
  /** Centered in that strip (e.g. the month switcher), between gridHeader and the legend. */
  gridHeaderCenter?: ReactNode;
};

/**
 * Shared month-calendar shell: owns the visible month + selected day, month
 * navigation (arrows + horizontal scroll/swipe), the Hebrew RTL grid scaffold
 * (weekday headers, Gregorian day number, Hebrew numeral, holiday shading).
 * Each calendar plugs in its own data via the render props — same chrome,
 * different content. Used by ProjectsCalendar and PaymentsCalendar.
 */
export default function MonthCalendar({
  todayIso,
  month,
  onMonthChange,
  hideNav = false,
  selected,
  onSelect,
  fixedPanel = false,
  toolbar,
  renderSelectedPanel,
  renderDayContent,
  renderDayHover,
  renderToolbar,
  legend,
  legendPlacement = "below",
  gridHeader,
  gridHeaderCenter,
}: Props) {
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  // Month is controlled when `month`+`onMonthChange` are supplied, else internal.
  const [internalMonth, setInternalMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const monthDate = month ?? internalMonth;
  const applyMonth = (next: Date) => {
    if (onMonthChange) onMonthChange(next);
    else setInternalMonth(next);
  };
  // Selection is controlled when `selected`+`onSelect` are supplied, else internal.
  const [internalSelected, setInternalSelected] = useState(today);
  const selectedDate = selected ?? internalSelected;
  const applySelect = (day: Date) => {
    if (onSelect) onSelect(day);
    else setInternalSelected(day);
  };

  // Hover popover (desktop): the cell being hovered + its on-screen rect. A short
  // close delay lets the pointer travel from the cell INTO the popover (to scroll
  // it) without it closing; entering the popover cancels the pending close.
  const [hover, setHover] = useState<{ day: Date; rect: DOMRect } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHover(null), 160);
  };
  const clearHover = () => { cancelClose(); setHover(null); };
  const openHover = (day: Date, rect: DOMRect) => { cancelClose(); setHover({ day, rect }); };

  const calendarDays = useMemo(() => {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = firstDay.getDay(); // 0=Sun … 6=Sat
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startOffset);
    // Only the weeks this month actually touches. A fixed six-week grid adds a
    // whole row of the NEXT month whenever the month fits in five — a row of
    // days that aren't being looked at, taking space from the ones that are.
    // Neighbouring days still appear where they share a week with this month.
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((startOffset + daysInMonth) / 7);
    return Array.from({ length: weeks * 7 }).map((_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [monthDate]);

  const holidaysByDay = useMemo(
    () => getHolidaysInRange(calendarDays[0], calendarDays[calendarDays.length - 1]),
    [calendarDays]
  );

  // A month change (arrows/swipe) invalidates the hovered cell's anchor rect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => clearHover(), [monthDate]);

  // Direction of the last month step drives the slide-in animation.
  const [navDir, setNavDir] = useState<"next" | "prev">("next");
  const prevMonth = () => {
    setNavDir("prev");
    applyMonth(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setNavDir("next");
    applyMonth(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1));
  };
  const goToMonth = (next: Date) => {
    setNavDir(monthDate.getTime() > next.getTime() ? "prev" : "next");
    applyMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    if (next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth()) applySelect(today);
  };

  // Horizontal (side) scroll / swipe over the grid steps the month. A time guard
  // collapses one continuous gesture into a single month step.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const lastNavRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const stepMonth = (forward: boolean) => {
    const now = Date.now();
    if (now - lastNavRef.current < 350) return;
    lastNavRef.current = now;
    if (forward) nextMonth();
    else prevMonth();
  };

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Horizontal (side) scroll changes the month; vertical scroll is left alone.
      if (Math.abs(e.deltaX) < 4 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      stepMonth(e.deltaX > 0);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Horizontal (side) swipe changes the month; vertical swipe scrolls the page.
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    stepMonth(dx > 0);
  };

  const selectedIso = isoLocal(selectedDate);

  return (
    <div className="space-y-4">
      {/* Desktop: [toolbar + grid] (main) + selected-day panel (aside). The
          toolbar lives INSIDE the main column so the aside rises to the top. */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          {/* Toolbar / month nav */}
          {toolbar ? (
            toolbar
          ) : !hideNav ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MonthNav month={monthDate} todayDate={today} onChange={goToMonth} />
              {renderToolbar ? renderToolbar(monthDate) : null}
            </div>
          ) : null}

          {/* Whole calendar in one border: [filters · legend strip] + weekday
              headers + day cells. */}
          <div>
          <div className="overflow-hidden rounded-xl border">
            {gridHeaderCenter ? (
              // Three columns (1fr · auto · 1fr) keep the center truly centered
              // on the grid whatever the side groups' widths; narrow screens
              // stack it, center first.
              <div className="flex flex-col items-center gap-2 border-b bg-card px-3 py-2 xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:gap-4">
                <div className="xl:order-2">{gridHeaderCenter}</div>
                {/* xl: one line, whatever the width — the column gives way (min-w-0
                    + shrink on the group) rather than the filters stacking. */}
                <div className="flex flex-wrap items-center justify-center gap-2 xl:order-1 xl:min-w-0 xl:flex-nowrap xl:justify-self-start">
                  {gridHeader}
                </div>
                <div className="xl:order-3 xl:justify-self-end">{legend && legendPlacement === "above" ? legend : null}</div>
              </div>
            ) : gridHeader || (legend && legendPlacement === "above") ? (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-card px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">{gridHeader}</div>
                {legendPlacement === "above" ? legend : null}
              </div>
            ) : null}
            <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
              {WEEK_DAYS.map((d) => (
                <div key={d} className="py-1.5">{d}</div>
              ))}
            </div>

            {/* Day cells */}
            <div
              ref={gridRef}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
              className="bg-border overflow-hidden"
            >
        <div
          key={`${monthDate.getFullYear()}-${monthDate.getMonth()}`}
          className={`grid grid-cols-7 gap-px animate-in fade-in-0 duration-200 ${
            navDir === "next" ? "slide-in-from-left-6" : "slide-in-from-right-6"
          }`}
        >
          {calendarDays.map((day) => {
            const inMonth = day.getMonth() === monthDate.getMonth();
            const isToday = isSameDay(day, today);
            const isSelected = isSameDay(day, selectedDate);
            const holidayInfo = holidaysByDay.get(isoLocal(day)) ?? null;
            const holiday = holidayInfo?.name ?? null;
            // Only MAJOR holidays tint the cell; minor ones (Rosh Chodesh, fasts…)
            // stay a normal work-day cell and only show their text label.
            const isHoliday = Boolean(holidayInfo?.major) && inMonth;

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => applySelect(day)}
                onMouseEnter={
                  renderDayHover
                    ? (e) => openHover(day, e.currentTarget.getBoundingClientRect())
                    : undefined
                }
                onMouseLeave={renderDayHover ? scheduleClose : undefined}
                title={holiday ?? undefined}
                className={`flex min-h-[4.5rem] flex-col gap-1 px-1.5 py-1.5 transition-colors ${
                  !inMonth
                    ? "bg-muted/20 text-muted-foreground/45"
                    : isHoliday
                      ? "bg-muted/40"
                      : "bg-background"
                } ${isSelected ? "z-10 ring-2 ring-inset ring-primary" : "hover:bg-secondary/10"}`}
              >
                {/* Date header — Gregorian number + Hebrew numeral on ONE row */}
                <div className="flex w-full items-center justify-between gap-1">
                  <span
                    className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-medium transition-colors ${
                      isToday
                        ? "bg-primary text-primary-foreground"
                        : isSelected
                          ? "bg-secondary/20 text-secondary font-semibold"
                          : ""
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <span className="text-[10px] leading-none text-muted-foreground">
                    {hebrewDayLabel(day)}
                  </span>
                </div>

                {/* Day content (dots / amount) — centered under the header */}
                <div className="flex flex-1 flex-col items-center justify-start gap-0.5">
                  {renderDayContent({ day, holiday, isToday, isSelected, inMonth })}
                </div>
              </button>
            );
          })}
              </div>
            </div>
          </div>
          </div>

          {legend && legendPlacement === "below" ? <div className="mt-3">{legend}</div> : null}
        </div>

        {/* Selected-day panel — beside the grid on desktop (matches its height),
            below it on mobile. With fixedPanel, the panel content is absolutely
            positioned on desktop so it fills (and never exceeds) the calendar's
            height — a long list scrolls inside it instead of stretching the row. */}
        <aside className={`min-w-0 ${fixedPanel ? "lg:relative" : ""}`}>
          <div className={fixedPanel ? "lg:absolute lg:inset-0" : ""}>
            {renderSelectedPanel({
              day: selectedDate,
              holiday: holidaysByDay.get(selectedIso)?.name ?? null,
              isToday: isSameDay(selectedDate, today),
            })}
          </div>
        </aside>
      </div>

      {/* Hover popover — anchored to the hovered cell, rendered outside the
          overflow-hidden/animated grid so it isn't clipped. */}
      {hover && renderDayHover ? (
        <DayHoverPopover
          rect={hover.rect}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          content={renderDayHover({
            day: hover.day,
            holiday: holidaysByDay.get(isoLocal(hover.day))?.name ?? null,
            isToday: isSameDay(hover.day, today),
            isSelected: isSameDay(hover.day, selectedDate),
            inMonth: hover.day.getMonth() === monthDate.getMonth(),
          })}
        />
      ) : null}
    </div>
  );
}

// Floating detail panel anchored to a hovered day cell. It opens BESIDE the
// cell (toward the week's next day — left in RTL — flipping right when there's
// no room), top-aligned with it and clamped to the viewport. Opening below the
// cell sat it squarely on the next week's cells, whose own amounts then read
// through as if they were part of the panel.
function DayHoverPopover({
  rect,
  content,
  onMouseEnter,
  onMouseLeave,
}: {
  rect: DOMRect;
  content: ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  if (!content || typeof document === "undefined") return null;

  const WIDTH = 260;
  const MAX_HEIGHT = 256; // 16rem — matches maxHeight below
  const GAP = 8;
  const MARGIN = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fitsLeft = rect.left - GAP - WIDTH >= MARGIN;
  const fitsRight = rect.right + GAP + WIDTH <= vw - MARGIN;
  const left = fitsLeft || !fitsRight
    ? Math.max(rect.left - GAP - WIDTH, MARGIN)
    : rect.right + GAP;
  const top = Math.max(MARGIN, Math.min(rect.top, vh - MAX_HEIGHT - MARGIN));

  const style: React.CSSProperties = { top, left, width: WIDTH };

  // Portaled to <body> so `position: fixed` resolves against the viewport, not
  // an ancestor with a transform (which would offset it to random-looking spots).
  // pointer-events-auto + onMouseEnter (cancels the cell's pending close) let the
  // user move onto the panel and SCROLL its list without it closing.
  return createPortal(
    <div
      dir="rtl"
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ position: "fixed", zIndex: 50, maxHeight: "16rem", ...style }}
      // Solid, no fade/zoom-in: the panel moves from cell to cell as the pointer
      // sweeps the grid, and a translucent entrance let the cells show through.
      className="pointer-events-auto overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-foreground/5"
    >
      {content}
    </div>,
    document.body
  );
}
