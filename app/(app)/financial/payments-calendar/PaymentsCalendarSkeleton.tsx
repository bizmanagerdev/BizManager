"use client";

import { useSearchParams } from "next/navigation";
import { CalendarIcon, FilterIcon, InfoIcon, RecurringIcon, SpinnerIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TextLineSkeleton, UnderlineTabsSkeleton } from "@/components/layout/loading-skeletons";
import { israelDateKey } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";

// The צפי תזרים page before its data, from PaymentsHubClient's header (the
// open tab and the money direction from the address, as the page reads them;
// on a phone the same two rows the page lays out by `order`) and the open
// tab's own classes: the calendar — the in-border strip with the month
// switcher and the legend, the weekday heads, this month's weeks (only the
// weeks it touches, today ringed) and the day panel beside it (under it on a
// phone); or the recurring list — the dark summary bar, the info / filters
// line, its cards and, in a wide container, its table. Shown while the page
// streams (loading.tsx).
//
// The labels are calendar.helpers' (DIRECTION_OPTIONS, the settled words) —
// written out, not imported: that file pulls in the calendar and its Hebrew
// dates, which a placeholder shouldn't wait for.

type Direction = "out" | "in" | "all";

const DIRECTIONS: Array<{ value: Direction; label: string }> = [
  { value: "out", label: "יוצא" },
  { value: "in", label: "נכנס" },
  { value: "all", label: "הכל" },
];

const SETTLED_WORD: Record<Direction, string> = { out: "שולם", in: "נגבה", all: "בוצע" };

const SUMMARY_LABEL: Record<Direction, string> = {
  out: "סה״כ התחייבות חודשית קבועה · רק מה שיוצא כל חודש",
  in: "סה״כ הכנסה חודשית קבועה · רק מה שנכנס כל חודש",
  all: "קבוע כל חודש · יוצא מול נכנס",
};

const WEEK_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

// The shared toolbar control's box (filter-chip's TOOLBAR_CONTROL).
const TOOLBAR_CONTROL = "h-[34px] rounded-lg border";

function directionOf(value: string | null): Direction {
  return value === "in" || value === "all" ? value : "out";
}

// The month on show (?month=YYYY-MM, else this month in Israel) as MonthCalendar
// lays it out: only the weeks it touches, Sunday first.
function monthCells(monthParam: string | null) {
  const [todayYear, todayMonth, todayDay] = israelDateKey().split("-").map(Number);
  const match = monthParam ? /^(\d{4})-(\d{2})$/.exec(monthParam) : null;
  const picked = match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
  const year = picked ? Number(match[1]) : todayYear;
  const month = picked ? Number(match[2]) - 1 : todayMonth - 1;
  const offset = new Date(year, month, 1).getDay();
  const weeks = Math.ceil((offset + new Date(year, month + 1, 0).getDate()) / 7);
  const isCurrent = year === todayYear && month === todayMonth - 1;
  const cells = Array.from({ length: weeks * 7 }).map((_, i) => {
    const date = new Date(year, month, 1 - offset + i);
    return {
      key: i,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: date.getFullYear() === todayYear && date.getMonth() === todayMonth - 1 && date.getDate() === todayDay,
    };
  });
  return { cells, isCurrent };
}

function Header({ tab, direction }: { tab: "calendar" | "recurring"; direction: Direction }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-3 max-md:contents">
        <UnderlineTabsSkeleton
          className="w-auto max-md:order-1"
          labels={[
            <>
              <CalendarIcon className="h-4 w-4" />
              לוח תזרים
            </>,
            <>
              <RecurringIcon className="h-4 w-4" />
              קבועות
            </>,
          ]}
          active={tab === "recurring" ? 1 : 0}
        />
        <div className="inline-flex h-[34px] overflow-hidden rounded-lg border border-input max-md:order-4">
          {DIRECTIONS.map((option) => (
            <span
              key={option.value}
              className={cn(
                "flex items-center px-3 text-xs font-semibold",
                option.value === direction ? "bg-secondary text-secondary-foreground" : "bg-background text-muted-foreground"
              )}
            >
              {option.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-md:contents">
        {tab === "calendar" ? (
          <>
            {/* The calendar's filters (a phone's are one סינון button) and its late chip. */}
            <div className="hidden md:contents">
              <Skeleton className={cn(TOOLBAR_CONTROL, "w-28 border-transparent")} />
              {direction === "in" ? null : (
                <span className={cn(TOOLBAR_CONTROL, "inline-flex shrink-0 items-center border-input bg-background px-3 text-xs font-semibold text-muted-foreground")}>
                  רק קבועות
                </span>
              )}
              <span className={cn(TOOLBAR_CONTROL, "inline-flex shrink-0 items-center border-input bg-background px-3 text-xs font-semibold text-muted-foreground")}>
                הצג ששולמו
              </span>
            </div>
            <span
              className={cn(
                TOOLBAR_CONTROL,
                "inline-flex items-center gap-1.5 border-secondary/30 bg-background px-3 text-xs font-medium text-secondary md:hidden max-md:order-5"
              )}
            >
              <FilterIcon className="h-4 w-4" />
              סינון
            </span>
            <Skeleton className={cn(TOOLBAR_CONTROL, "w-24 border-transparent max-md:order-6 max-md:w-11")} />
          </>
        ) : null}
        {/* כמה צריך? — on a phone just its glyph, ending the first row. */}
        <Skeleton className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-transparent px-3 text-sm font-medium text-transparent max-md:order-2 max-md:h-[34px] max-md:w-[34px] max-md:px-0">
          <span className="h-4 w-4 shrink-0" />
          <span className="max-md:hidden">כמה צריך?</span>
        </Skeleton>
        <div aria-hidden className="hidden h-0 basis-full max-md:order-3 max-md:block" />
        {tab === "recurring" ? (
          <>
            <ButtonSkeleton label="הוצאה קבועה חדשה" size="sm" icon className="max-md:order-5" />
            <ButtonSkeleton label="השלמת חיובים חסרים" size="sm" icon className="max-md:order-6" />
          </>
        ) : null}
      </div>
    </div>
  );
}

// PaymentItemCard's compact row, as the day panel lists it.
function DayItemSkeleton() {
  return (
    <div className="rounded-lg border bg-background px-3 py-2.5">
      <div className="flex items-start gap-2 text-sm">
        <Skeleton className="mt-1 h-2 w-2 shrink-0 rounded-full" />
        <TextLineSkeleton className="min-w-0 flex-1 leading-snug" barClassName="w-28" />
        <TextLineSkeleton className="shrink-0" barClassName="w-14" />
      </div>
      <TextLineSkeleton className="mt-1.5 text-xs" barClassName="w-32" />
      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
        <Skeleton className="h-9 w-24 rounded-xl" />
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
    </div>
  );
}

function CalendarSkeleton({ direction, monthParam }: { direction: Direction; monthParam: string | null }) {
  const { cells, isCurrent } = monthCells(monthParam);
  return (
    <div className="space-y-3">
      <div className="space-y-4">
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <div>
              <div className="overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-card px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border bg-background text-muted-foreground">‹</span>
                      <span className="min-w-[7rem] text-center text-base font-bold">
                        <Skeleton className="inline-block h-[0.75em] w-24 align-middle" />
                      </span>
                      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border bg-background text-muted-foreground">›</span>
                      <span
                        className={cn(
                          "flex h-[34px] items-center rounded-lg border bg-background px-3 text-xs font-semibold text-muted-foreground",
                          isCurrent && "opacity-40"
                        )}
                      >
                        היום
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-destructive" />
                      באיחור
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-warning" />
                      ממתין
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/60" />
                      צפוי
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-success" />
                      {SETTLED_WORD[direction]}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
                  {WEEK_DAYS.map((day) => (
                    <div key={day} className="py-1.5">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="overflow-hidden bg-border">
                  <div className="grid grid-cols-7 gap-px">
                    {cells.map((cell) => (
                      <div
                        key={cell.key}
                        className={cn(
                          "flex min-h-[4.5rem] flex-col gap-1 px-1.5 py-1.5",
                          cell.inMonth ? "bg-background" : "bg-muted/20 text-muted-foreground/45",
                          cell.isToday && "z-10 ring-2 ring-inset ring-primary"
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-1">
                          <span
                            className={cn(
                              "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-medium",
                              cell.isToday && "bg-primary text-primary-foreground"
                            )}
                          >
                            {cell.day}
                          </span>
                          <Skeleton className="h-2.5 w-3" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* The selected day (today) — beside the grid and as tall as it from lg, under it below. */}
          <aside className="min-w-0 lg:relative">
            <div className="lg:absolute lg:inset-0">
              <div className="flex h-full flex-col rounded-2xl border bg-card p-4">
                <div className="border-b pb-3">
                  {/* The panel opens on today, whichever month is on show. */}
                  <div className="text-[11px] font-semibold text-primary">היום</div>
                  <TextLineSkeleton className="mt-0.5 text-xl font-bold leading-tight" barClassName="w-40" />
                  <TextLineSkeleton className="mt-1 text-xs" barClassName="w-24" />
                </div>
                <div className="mt-3 min-h-0 flex-1 overflow-hidden">
                  <div className="space-y-2.5">
                    <DayItemSkeleton />
                    <DayItemSkeleton />
                  </div>
                </div>
                {direction === "all" ? null : (
                  <div className="mt-3">
                    <ButtonSkeleton label={direction === "in" ? "הוסף תקבול ליום זה" : "הוסף תשלום ליום זה"} icon className="w-full" />
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

const RECURRING_COLUMNS = [
  { label: "מועד תשלום", className: "" },
  { label: null, className: "w-[10rem] min-w-[10rem]" },
  { label: "שם ותיאור", className: "" },
  { label: "תחום · שיוך", className: "" },
  { label: "סכום", className: "" },
  { label: null, className: "w-[12rem] min-w-[12rem]" },
  { label: "תזכורת", className: "w-[11rem] min-w-[11rem]" },
  { label: "פעיל", className: "w-[7rem] min-w-[7rem]" },
  { label: "פעולות", className: "" },
];

// RecurringExpensesManager as it first paints: the summary bar still waiting
// for salaries and loans, the info / filters line, the cards — the table once
// the container is wide enough (@5xl, as on the page).
function RecurringSkeleton({ direction }: { direction: Direction }) {
  return (
    <div className="space-y-4 text-right">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 rounded-xl bg-foreground px-4 py-2.5 text-background">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <div className="h-7 w-32 animate-pulse rounded-md bg-background/20" />
            <div className="text-xs opacity-70">{SUMMARY_LABEL[direction]}</div>
          </div>
          <div className="text-xs opacity-90">
            <span className="inline-flex items-center gap-2">
              <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
              טוען משכורות, הלוואות וכרטיסים...
            </span>
          </div>
        </div>
      </div>
      <div className="@container space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 px-2 text-muted-foreground">
            <InfoIcon className="h-4 w-4" />
            <span className="text-xs">מה יש כאן?</span>
          </span>
          <div className="flex flex-wrap items-center gap-2 @5xl:hidden">
            <Skeleton className="h-9 w-auto min-w-[9rem] rounded-lg" />
            <Skeleton className="h-9 w-auto min-w-[10rem] rounded-lg" />
          </div>
        </div>
        <div className="space-y-2 @5xl:hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="space-y-3 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TextLineSkeleton className="text-xs" barClassName="w-28" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
                <TextLineSkeleton className="font-medium" barClassName="w-40" />
                <TextLineSkeleton className="text-xs" barClassName="w-24" />
                <div className="grid gap-1 text-xs">
                  <TextLineSkeleton barClassName="w-20" />
                  <TextLineSkeleton barClassName="w-36" />
                  <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                    {["חשבון", "תזכורת"].map((label) => (
                      <div key={label} className="space-y-1">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <Skeleton className="h-9 w-full rounded-lg" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Skeleton className="h-5 w-9 rounded-full" />
                  <Skeleton className="h-9 w-9 rounded-xl" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="hidden max-h-[70vh] overflow-hidden rounded-xl border @5xl:block">
          <table dir="rtl" className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b-2 bg-muted text-xs font-semibold text-muted-foreground">
              <tr>
                {RECURRING_COLUMNS.map((column, i) => (
                  <th key={i} className={cn("px-3 py-2 text-right font-medium", column.className)}>
                    {column.label ?? <Skeleton className="h-9 w-full rounded-lg bg-background/70" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {Array.from({ length: 8 }).map((_, row) => (
                <tr key={row} className="h-[3.25rem] align-top">
                  {RECURRING_COLUMNS.map((_, cell) => (
                    <td key={cell} className="px-3 py-2">
                      <Skeleton className={cell === 2 ? "h-4 w-4/5" : "h-4 w-3/5"} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function PaymentsCalendarSkeleton() {
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab") === "recurring" ? "recurring" : "calendar";
  const direction = directionOf(searchParams?.get("dir") ?? null);
  return (
    <div className="space-y-4" dir="rtl" aria-busy="true">
      <Header tab={tab} direction={direction} />
      {/* TabsContent's own mt-4 (it meets the header's gap, as on the page). */}
      <div className="mt-4">
        {tab === "recurring" ? (
          <RecurringSkeleton direction={direction} />
        ) : (
          <CalendarSkeleton direction={direction} monthParam={searchParams?.get("month") ?? null} />
        )}
      </div>
    </div>
  );
}
