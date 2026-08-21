"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AddIcon, CalendarIcon, MoreIcon, SearchIcon } from "@/components/ui/icons";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { calendarDict, type CalendarKey } from "@/lib/i18n/dictionaries/calendar";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/types";

// ── Event-kind metadata ───────────────────────────────────────────────────────
// Single source of truth for color per kind, so the summary tiles, grid chips,
// filter chips and detail list all stay in lockstep. Order here drives the
// tile + chip order (reminder → project → task). Labels are locale-dependent —
// see kindLabel/kindPlural below.
type Kind = CalendarEntryKind;

const KIND_ORDER: Kind[] = ["reminder", "project", "task", "delivery"];

// `border` is the FULL (not edge-only) border color used by the filter chips —
// red/destructive is reserved for urgent/danger elsewhere in the app, so
// delivery gets purple (app/globals.css's --purple-*, the one hue not already
// claimed by a status) instead of competing with task's warning-red urgency.
const KIND_META: Record<Kind, { dot: string; edge: string; border: string }> = {
  reminder: { dot: "bg-info", edge: "border-e-info", border: "border-info" },
  project: { dot: "bg-success", edge: "border-e-success", border: "border-success" },
  task: { dot: "bg-warning", edge: "border-e-warning", border: "border-warning" },
  delivery: {
    dot: "bg-palette-purple-4",
    edge: "border-e-palette-purple-4",
    border: "border-palette-purple-4",
  },
};

const KIND_LABEL_KEY: Record<Kind, CalendarKey> = {
  reminder: "kindReminderLabel",
  project: "kindProjectLabel",
  task: "kindTaskLabel",
  delivery: "kindDeliveryLabel",
};

const KIND_PLURAL_KEY: Record<Kind, CalendarKey> = {
  reminder: "kindReminderPlural",
  project: "kindProjectPlural",
  task: "kindTaskPlural",
  delivery: "kindDeliveryPlural",
};

function kindLabel(locale: Locale, kind: Kind) {
  return t(calendarDict, locale, KIND_LABEL_KEY[kind]);
}

function kindPlural(locale: Locale, kind: Kind) {
  return t(calendarDict, locale, KIND_PLURAL_KEY[kind]);
}

const WEEK_DAY_KEYS: CalendarKey[] = [
  "weekDaySun",
  "weekDayMon",
  "weekDayTue",
  "weekDayWed",
  "weekDayThu",
  "weekDayFri",
  "weekDaySat",
];

function weekDayLabels(locale: Locale) {
  return WEEK_DAY_KEYS.map((key) => t(calendarDict, locale, key));
}

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
  locale,
}: {
  entries: CalendarEntry[];
  /** When provided (admin/office), the header שלי/הכל menu is shown. */
  allEntries?: CalendarEntry[] | null;
  todayIso: string;
  locale: Locale;
}) {
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  const weekDays = useMemo(() => weekDayLabels(locale), [locale]);
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
  const [peek, setPeek] = useState<"month" | "year" | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPeek = useCallback((mode: "month" | "year") => {
    setPeek(mode);
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(null), 1400);
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
    showPeek("month");
  }, [today, showPeek]);

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
    let swipeX: number | null = null;
    let swipeY: number | null = null;
    let wheelAcc = 0;
    let lastStep = 0;

    const step = (delta: number) => {
      const now = performance.now();
      if (now - lastStep < 250) return;
      lastStep = now;
      setNavDir(delta > 0 ? "next" : "prev");
      setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
      showPeek(Math.abs(delta) >= 12 ? "year" : "month");
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchDist = dist(e.touches);
        pinchZoom = zoomRef.current;
        swipeX = null;
        swipeY = null;
      } else if (e.touches.length === 1) {
        swipeX = e.touches[0].clientX;
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
      if (e.touches.length === 0 && swipeX != null && swipeY != null) {
        const t = e.changedTouches[0];
        const dx = (t?.clientX ?? swipeX) - swipeX;
        const dy = (t?.clientY ?? swipeY) - swipeY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 45) {
          step(dx < 0 ? -12 : 12); // swipe right → next year, swipe left → previous
        } else if (Math.abs(dy) > 40) {
          step(dy < 0 ? 1 : -1); // up → next month, down → previous month
        }
      }
      if (e.touches.length < 2) pinchDist = 0;
      if (e.touches.length === 0) {
        swipeX = null;
        swipeY = null;
      }
    };
    const onWheel = (e: WheelEvent) => {
      // Horizontal wheel steps the year; vertical steps the month.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        wheelAcc += e.deltaX;
        if (Math.abs(wheelAcc) > 60) {
          step(wheelAcc < 0 ? -12 : 12);
          wheelAcc = 0;
        }
      } else {
        wheelAcc += e.deltaY;
        if (Math.abs(wheelAcc) > 60) {
          step(wheelAcc > 0 ? 1 : -1);
          wheelAcc = 0;
        }
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

  // Search across the calendar's items (from the ⋮ menu) → jump to the match's day.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shownEntries
      .filter((e) => `${e.title} ${e.subtitle ?? ""}`.toLowerCase().includes(q))
      .slice(0, 60);
  }, [query, shownEntries]);
  function jumpToEntry(entry: CalendarEntry) {
    const d = toDateOnly(entry.startDate);
    if (d) {
      setNavDir("next");
      setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
      setSelected(d);
      setFilter("all");
    }
    setSearchOpen(false);
    setQuery("");
  }

  // Long-press / right-click a day → a small menu (see details / add event → kind).
  const [ctxDay, setCtxDay] = useState<Date | null>(null);
  const [ctxMode, setCtxMode] = useState<"root" | "add">("root");
  function openContext(day: Date) {
    setCtxMode("root");
    setCtxDay(day);
  }
  function contextSeeDetails() {
    if (ctxDay) {
      setSelected(ctxDay);
      setFilter("all");
      setSheetOpen(true);
    }
    setCtxDay(null);
  }
  function contextAdd(action: "task" | "project" | "reminder" | "delivery") {
    if (ctxDay) {
      window.dispatchEvent(
        new CustomEvent("bizh:quick-create", { detail: { action, dueDate: isoLocal(ctxDay) } })
      );
    }
    setCtxDay(null);
  }

  const selectedEntries = entriesOnDay(selected);
  const selectedHoliday = useMemo(
    () => getHolidaysInRange(selected, selected).get(isoLocal(selected))?.name ?? null,
    [selected]
  );
  const selectedParsha = useMemo(() => hebrewParsha(selected), [selected]);

  const hebShort = hebrewFullDate(selected).replace(/\s+\S+$/, "");
  // Header = Gregorian month/year (title) + Hebrew month/year (subtitle), both of
  // the VIEWED month, updating as you page — like the reference calendar.
  const gregLabel = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month),
    [month]
  );
  const hebMonth = useMemo(
    () => hebrewFullDate(new Date(month.getFullYear(), month.getMonth(), 15)).replace(/^\S+\s/, ""),
    [month]
  );
  // Header (between back arrow + title): the ⋮ menu — search + scope. Jump-to-today
  // lives in the selected-day row instead.
  const headerAction = useMemo(
    () => (
      <HeaderMenu
        canToggleScope={canToggleScope}
        scope={scope}
        onScope={setScope}
        onSearch={() => setSearchOpen(true)}
        locale={locale}
      />
    ),
    [canToggleScope, scope, locale]
  );
  useSetPageTitle(gregLabel, hebMonth, headerAction);

  return (
    // Cancel the app shell's bottom padding on this page so the calendar can fill
    // to the bottom nav without the page itself ever scrolling.
    <div className="-mb-24 space-y-3 md:mb-0">
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Mobile: a fixed-height flex column (chrome above + bottom nav reserved)
            so the calendar flex-child fills exactly — no bottom gap, no page
            scroll. Desktop: normal flow beside the side panel. */}
        <div className="flex h-[calc(100dvh-9.25rem)] min-w-0 flex-col md:block md:h-auto">
          {/* Selected-day row: jump-to-today (left) + the day's Gregorian + Hebrew
              date (right), then the labeled count filters. */}
          <div className="-mx-3 shrink-0 space-y-1.5 border-b bg-background px-2 py-1.5 lg:hidden">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="min-w-0 overflow-hidden whitespace-nowrap text-sm">
                <span className="font-semibold text-foreground">{fmtFullDay(selected)}</span>
                <span className="text-muted-foreground"> · {hebShort}</span>
              </span>
              <button
                type="button"
                onClick={scrollToToday}
                className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground transition-colors hover:bg-secondary/90"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                {t(commonDict, locale, "today")}
              </button>
            </div>
            <FilterToolbar entries={selectedEntries} filter={filter} onPick={pickKind} locale={locale} />
          </div>

          {/* One month at a time — a scroll / swipe steps to the next or previous
              month (no arrows). Full-bleed on phones, a bordered card from md up. */}
          <div
            ref={scrollRef}
            className="relative -mx-3 min-h-0 flex-1 touch-none overflow-hidden border-b md:mx-0 md:h-[calc(100vh-11rem)] md:flex-none md:rounded-2xl md:border md:border-t"
          >
            {/* Transient month/year label — shows on a page change, then fades. A
                year jump shows the year big so it's obvious you switched years. */}
            {peek ? (
              <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex animate-in fade-in-0 justify-center">
                <div className="flex flex-col items-center gap-0.5 rounded-2xl bg-sidebar/90 px-4 py-2 text-sidebar-foreground shadow-lg backdrop-blur">
                  {peek === "year" ? (
                    <span className="text-2xl font-bold leading-none">{month.getFullYear()}</span>
                  ) : null}
                  <span className="text-xs font-semibold">
                    {fmtMonthYear(month)} · {hebMonth}
                  </span>
                </div>
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
                  onLongPress={openContext}
                  entriesOnDay={entriesOnDay}
                  weekDays={weekDays}
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
              <FilterToolbar entries={selectedEntries} filter={filter} onPick={setFilter} locale={locale} />
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
                locale={locale}
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
        locale={locale}
      />

      {/* Long-press / right-click a day → see details or add an event. */}
      <Sheet open={ctxDay !== null} onOpenChange={(open) => !open && setCtxDay(null)}>
        <SheetContent side="bottom" className="rounded-t-[1.5rem] p-4">
          <SheetHeader className="mb-3 text-start">
            <SheetTitle>{ctxDay ? fmtFullDay(ctxDay) : ""}</SheetTitle>
          </SheetHeader>
          {ctxMode === "root" ? (
            <div className="space-y-2">
              <ContextButton onClick={contextSeeDetails}>{t(calendarDict, locale, "viewDetails")}</ContextButton>
              <ContextButton onClick={() => setCtxMode("add")}>
                <AddIcon className="h-4 w-4" />
                {t(calendarDict, locale, "addEvent")}
              </ContextButton>
            </div>
          ) : (
            <div className="space-y-2">
              <ContextButton onClick={() => contextAdd("task")}>
                <span className="h-2 w-2 rounded-full bg-warning" />
                {kindLabel(locale, "task")}
              </ContextButton>
              <ContextButton onClick={() => contextAdd("project")}>
                <span className="h-2 w-2 rounded-full bg-success" />
                {kindLabel(locale, "project")}
              </ContextButton>
              <ContextButton onClick={() => contextAdd("reminder")}>
                <span className="h-2 w-2 rounded-full bg-info" />
                {kindLabel(locale, "reminder")}
              </ContextButton>
              <ContextButton onClick={() => contextAdd("delivery")}>
                <span className="h-2 w-2 rounded-full bg-palette-purple-4" />
                {kindLabel(locale, "delivery")}
              </ContextButton>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Search across the calendar's items → tap a result to jump to its day. */}
      <Sheet
        open={searchOpen}
        onOpenChange={(open) => {
          setSearchOpen(open);
          if (!open) setQuery("");
        }}
      >
        <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto rounded-t-[1.5rem] p-4">
          <SheetHeader className="mb-3 text-start">
            <SheetTitle>{t(commonDict, locale, "search")}</SheetTitle>
          </SheetHeader>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(calendarDict, locale, "searchPlaceholder")}
              className="ps-9"
            />
          </div>
          <div className="mt-3 space-y-2">
            {query.trim() === "" ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t(calendarDict, locale, "typeToSearchCalendar")}
              </div>
            ) : searchResults.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t(calendarDict, locale, "noSearchResults")}
              </div>
            ) : (
              searchResults.map((e) => {
                const d = toDateOnly(e.startDate);
                return (
                  <button
                    key={`${e.kind}-${e.id}`}
                    type="button"
                    onClick={() => jumpToEntry(e)}
                    className="flex w-full items-center gap-2 rounded-xl border p-3 text-start transition-colors hover:bg-secondary/5"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_META[e.kind].dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{e.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {d ? fmtFullDay(d) : ""} · {kindLabel(locale, e.kind)}
                        {e.subtitle ? ` · ${e.subtitle}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ContextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl border p-3 text-start text-sm font-medium transition-colors hover:bg-secondary/5"
    >
      {children}
    </button>
  );
}

// ── Header ⋮ menu: search the calendar + choose the scope ──────────────────────
function HeaderMenu({
  canToggleScope,
  scope,
  onScope,
  onSearch,
  locale,
}: {
  canToggleScope: boolean;
  scope: "mine" | "all";
  onScope: (next: "mine" | "all") => void;
  onSearch: () => void;
  locale: Locale;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t(calendarDict, locale, "optionsAria")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-white/10"
        >
          <MoreIcon className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-right">
        <DropdownMenuItem onSelect={onSearch} className="gap-2">
          <SearchIcon className="h-4 w-4" />
          {t(commonDict, locale, "search")}
        </DropdownMenuItem>
        {canToggleScope ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex gap-1 rounded-full bg-muted p-1">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onScope(s)}
                  className={`flex-1 rounded-full px-3 py-1 text-sm transition-colors ${
                    scope === s
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {s === "mine" ? t(calendarDict, locale, "scopeMine") : t(calendarDict, locale, "all")}
                </button>
              ))}
            </div>
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
  onLongPress,
  entriesOnDay,
  weekDays,
}: {
  month: Date;
  today: Date;
  selected: Date;
  onSelect: (day: Date) => void;
  onLongPress: (day: Date) => void;
  entriesOnDay: (day: Date) => DayEntry[];
  weekDays: string[];
}) {
  // Long-press (or right-click) a day → context menu. One shared timer since only
  // one cell is pressed at a time.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressPos = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
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
      <div className="grid shrink-0 grid-cols-7 border-b bg-muted text-center text-[11px] font-medium text-muted-foreground">
        {weekDays.map((d) => (
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
              onClick={() => {
                if (longFired.current) {
                  longFired.current = false;
                  return;
                }
                onSelect(day);
              }}
              onPointerDown={(e) => {
                longFired.current = false;
                pressPos.current = { x: e.clientX, y: e.clientY };
                cancelPress();
                pressTimer.current = setTimeout(() => {
                  longFired.current = true;
                  onLongPress(day);
                }, 450);
              }}
              onPointerMove={(e) => {
                if (!pressPos.current || !pressTimer.current) return;
                if (Math.hypot(e.clientX - pressPos.current.x, e.clientY - pressPos.current.y) > 10) {
                  cancelPress();
                }
              }}
              onPointerUp={cancelPress}
              onPointerCancel={cancelPress}
              onContextMenu={(e) => {
                e.preventDefault();
                longFired.current = true;
                onLongPress(day);
              }}
              title={holiday ?? undefined}
              className={`relative flex flex-col gap-px overflow-hidden rounded px-0.5 pb-[1em] pt-[1.35em] text-start transition-colors ${
                !inMonth
                  ? "bg-secondary/5 text-muted-foreground"
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

              {/* Hebrew date — bottom-left corner (dark & readable on out-of-month
                  cells too, so those days don't blur into the tint). */}
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
  locale,
}: {
  entries: DayEntry[];
  filter: Filter;
  onPick: (filter: Filter) => void;
  locale: Locale;
}) {
  const counts = KIND_ORDER.map((kind) => ({
    kind,
    count: entries.filter((e) => e.kind === kind).length,
  }));
  return (
    <div className="flex flex-nowrap items-center justify-between gap-1 overflow-x-auto">
      <FilterPill
        active={filter === "all"}
        label={t(calendarDict, locale, "all")}
        count={entries.length}
        onClick={() => onPick("all")}
      />
      {counts.map(({ kind, count }) => (
        <FilterPill
          key={kind}
          active={filter === kind}
          label={kindPlural(locale, kind)}
          count={count}
          border={KIND_META[kind].border}
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
  border,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  /** The kind's full-border color class (KIND_META[kind].border) — replaces a
   *  dot so more chips fit in one non-wrapping row. */
  border?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1 rounded-full border-2 px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-secondary bg-secondary/10 text-secondary"
          : `${border ?? "border-border"} bg-background text-muted-foreground hover:bg-secondary/5`
      }`}
    >
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
  locale,
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
  locale: Locale;
}) {
  const shown = filter === "all" ? entries : entries.filter((e) => e.kind === filter);

  // The active filter decides WHAT gets created: on a specific kind, add that
  // kind; on "הכל" (the default), add a task. QuickCreateMenu handles the event.
  const addAction: Kind = filter === "all" ? "task" : filter;
  const addLabel =
    filter === "all"
      ? t(calendarDict, locale, "addToThisDay")
      : `${t(calendarDict, locale, "addKindPrefix")} ${kindLabel(locale, filter)}`;

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
            {hebrewFullDate(day)} ·{" "}
            {entries.length
              ? `${entries.length} ${t(calendarDict, locale, "items")}`
              : t(calendarDict, locale, "noItems")}
            {holiday ? ` · ${holiday}` : ""}
          </div>
        </div>
      )}

      {/* Filter chips — hidden where the header count tiles act as the filter.
          nowrap + overflow-x-auto (not flex-wrap): a wrapped 2nd row read as
          broken layout — this always stays one scrollable row, same as
          FilterToolbar above. */}
      {hideFilters ? null : (
        <div className="flex flex-nowrap gap-1.5 overflow-x-auto">
          <FilterChip active={filter === "all"} onClick={() => onFilter("all")}>
            {t(calendarDict, locale, "all")}
          </FilterChip>
          {KIND_ORDER.map((kind) => (
            <FilterChip key={kind} active={filter === kind} border={KIND_META[kind].border} onClick={() => onFilter(kind)}>
              {kindLabel(locale, kind)}
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
                  {kindLabel(locale, entry.kind)}
                </span>
              </div>
              {entry.subtitle ? (
                <div className="mt-0.5 text-xs text-muted-foreground">{entry.subtitle}</div>
              ) : null}
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState>
          {entries.length ? t(calendarDict, locale, "noItemsOfKind") : t(calendarDict, locale, "noItemsThisDay")}
        </EmptyState>
      )}

      {/* Add to this day */}
      <button
        type="button"
        onClick={addToDay}
        className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-secondary/40 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-secondary/5"
      >
        <AddIcon className="h-4 w-4" />
        {addLabel}
      </button>
    </div>
  );
}

function FilterChip({
  active,
  border,
  onClick,
  children,
}: {
  active: boolean;
  /** The kind's full-border color class (KIND_META[kind].border) — replaces a
   *  dot so more chips fit in one row. */
  border?: string;
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
          : `border-2 ${border ?? "border-border"} bg-background text-muted-foreground hover:bg-secondary/10`
      }`}
    >
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
  locale,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  day: Date;
  entries: DayEntry[];
  holiday: string | null;
  filter: Filter;
  onFilter: (next: Filter) => void;
  locale: Locale;
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
            {hebrewFullDate(day)} ·{" "}
            {entries.length
              ? `${entries.length} ${t(calendarDict, locale, "items")}`
              : t(calendarDict, locale, "noItems")}
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
          locale={locale}
        />
      </SheetContent>
    </Sheet>
  );
}
