"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  /** Panel above the calendar showing the selected day's items. */
  renderSelectedPanel: (ctx: SelectedContext) => ReactNode;
  /** Dots / amount / count rendered under each day cell (after day number + Hebrew numeral). */
  renderDayContent: (ctx: DayContext) => ReactNode;
  /** Optional slot between the month-nav row and the grid (e.g. month total + toggles). */
  renderToolbar?: (monthDate: Date) => ReactNode;
  /** Legend row under the grid. */
  legend?: ReactNode;
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
  renderSelectedPanel,
  renderDayContent,
  renderToolbar,
  legend,
}: Props) {
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = firstDay.getDay(); // 0=Sun … 6=Sat
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startOffset);
    return Array.from({ length: 42 }).map((_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [monthDate]);

  const holidaysByDay = useMemo(
    () => getHolidaysInRange(calendarDays[0], calendarDays[calendarDays.length - 1]),
    [calendarDays]
  );

  // Direction of the last month step drives the slide-in animation.
  const [navDir, setNavDir] = useState<"next" | "prev">("next");
  const prevMonth = () => {
    setNavDir("prev");
    setMonthDate((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setNavDir("next");
    setMonthDate((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1));
  };
  const goToday = () => {
    const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    setNavDir(monthDate.getTime() > todayMonth.getTime() ? "prev" : "next");
    setMonthDate(todayMonth);
    setSelectedDate(today);
  };
  const onCurrentMonth =
    monthDate.getFullYear() === today.getFullYear() && monthDate.getMonth() === today.getMonth();

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
      {/* Selected day panel — supplied by the caller */}
      {renderSelectedPanel({
        day: selectedDate,
        holiday: holidaysByDay.get(selectedIso) ?? null,
        isToday: isSameDay(selectedDate, today),
      })}

      {/* Month navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="חודש קודם"
          className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-secondary/10"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{fmtMonthYear(monthDate)}</span>
          {!onCurrentMonth ? (
            <button
              type="button"
              onClick={goToday}
              className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              חזרה להיום
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="חודש הבא"
          className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-secondary/10"
        >
          ›
        </button>
      </div>

      {/* Optional toolbar (totals, toggles) */}
      {renderToolbar ? renderToolbar(monthDate) : null}

      {/* Weekday headers */}
      <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div
        ref={gridRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="rounded-xl border bg-secondary/30 overflow-hidden"
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
            const holiday = holidaysByDay.get(isoLocal(day)) ?? null;
            // Holidays render as a solid dark-primary cell (light text); the light
            // secondary "other month" cells and normal cells keep dark text.
            const darkHoliday = Boolean(holiday) && inMonth;

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelectedDate(day)}
                title={holiday ?? undefined}
                className={`flex min-h-[3.75rem] flex-col items-center gap-0.5 px-1 py-2 transition-colors ${
                  !inMonth
                    ? "bg-muted text-muted-foreground"
                    : darkHoliday
                      ? "bg-primary text-primary-foreground"
                      : "bg-background"
                } ${isSelected ? "ring-1 ring-inset ring-primary/40" : "hover:bg-secondary/10"}`}
              >
                {/* Day number (Gregorian) */}
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                    isToday
                      ? "bg-primary text-primary-foreground"
                      : isSelected
                        ? "bg-secondary/20 text-secondary font-semibold"
                        : ""
                  }`}
                >
                  {day.getDate()}
                </span>

                {/* Hebrew day numeral */}
                <span className={`text-[10px] leading-none ${darkHoliday ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                  {hebrewDayLabel(day)}
                </span>

                {renderDayContent({ day, holiday, isToday, isSelected, inMonth })}
              </button>
            );
          })}
        </div>
      </div>

      {legend}
    </div>
  );
}
