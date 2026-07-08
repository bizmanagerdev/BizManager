"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isoLocal, toDateOnly, isSameDay } from "@/components/ui/month-calendar";

const WEEK_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

function fmtShort(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}
function monthLabel(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function buildDays(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay()); // back up to Sunday
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

/**
 * Two-calendar date-range picker (flight-site style): click the start day, then
 * the end day — the range fills in between (with a live hover preview). Empty
 * range = "כל התקופה". Values are ISO (YYYY-MM-DD).
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  todayIso,
  className,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  todayIso?: string;
  className?: string;
}) {
  const startDate = toDateOnly(from);
  const endDate = toDateOnly(to);
  const today = toDateOnly(todayIso ?? "") ?? new Date();

  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [hovered, setHovered] = useState<Date | null>(null);
  const [leftMonth, setLeftMonth] = useState<Date>(
    () => new Date((startDate ?? today).getFullYear(), (startDate ?? today).getMonth(), 1)
  );

  const months = useMemo(() => [leftMonth, addMonths(leftMonth, 1)], [leftMonth]);

  function handleDay(d: Date) {
    if (!pendingStart) {
      setPendingStart(d);
      return;
    }
    const [s, e] = pendingStart <= d ? [pendingStart, d] : [d, pendingStart];
    onChange(isoLocal(s), isoLocal(e));
    setPendingStart(null);
    setHovered(null);
    setOpen(false);
  }
  function clear() {
    onChange("", "");
    setPendingStart(null);
    setHovered(null);
  }

  // Range to paint: confirmed range, or pending start → hovered day preview.
  const [rangeA, rangeB] = pendingStart
    ? (() => {
        const other = hovered ?? pendingStart;
        return pendingStart <= other ? [pendingStart, other] : [other, pendingStart];
      })()
    : [startDate, endDate];
  const inRange = (d: Date) => !!(rangeA && rangeB && d >= rangeA && d <= rangeB);
  const isEdge = (d: Date) => !!((rangeA && isSameDay(d, rangeA)) || (rangeB && isSameDay(d, rangeB)));

  const label = startDate && endDate ? `${fmtShort(startDate)} – ${fmtShort(endDate)}` : "כל התקופה";
  const hasRange = Boolean(from || to);

  const renderMonth = (mDate: Date, idx: number) => (
    <div key={idx} className="w-60">
      <div className="mb-1 flex h-7 items-center justify-between">
        {idx === 0 ? (
          <button type="button" onClick={() => setLeftMonth((m) => addMonths(m, -1))} className="rounded-md p-1 hover:bg-muted" aria-label="חודש קודם">
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <span className="w-6" />
        )}
        <span className="text-sm font-medium">{monthLabel(mDate)}</span>
        {idx === months.length - 1 ? (
          <button type="button" onClick={() => setLeftMonth((m) => addMonths(m, 1))} className="rounded-md p-1 hover:bg-muted" aria-label="חודש הבא">
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="w-6" />
        )}
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {buildDays(mDate).map((d) => {
          const inMonth = d.getMonth() === mDate.getMonth();
          const edge = isEdge(d);
          const within = inRange(d) && !edge;
          const isToday = isSameDay(d, today);
          return (
            <button
              key={isoLocal(d)}
              type="button"
              onClick={() => handleDay(d)}
              onMouseEnter={() => setHovered(d)}
              className={cn(
                "h-8 w-8 rounded-md text-sm tabular-nums transition-colors",
                !inMonth && "text-muted-foreground/40",
                within && "bg-primary/15",
                edge && "bg-primary font-semibold text-primary-foreground",
                !edge && !within && "hover:bg-muted",
                isToday && !edge && "ring-1 ring-primary/40"
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPendingStart(null);
          setHovered(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm shadow-sm hover:bg-muted",
            className
          )}
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="tabular-nums" dir="ltr">{label}</span>
          {hasRange ? (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
            />
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          dir="rtl"
          align="start"
          sideOffset={6}
          className="z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
          onMouseLeave={() => setHovered(null)}
        >
          <div className="flex flex-col gap-4 sm:flex-row">{months.map(renderMonth)}</div>
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <button type="button" onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">
              נקה
            </button>
            <span className="text-xs text-muted-foreground">
              {pendingStart ? "בחר תאריך סיום" : "בחר תאריך התחלה"}
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
