import { AddIcon, CalendarIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getHolidaysInRange, hebrewDayLabel, hebrewFullDate, hebrewParsha } from "@/lib/hebrew-calendar";
import { israelDateKey } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// The calendar before its entries: CalendarView's own frame — on a phone the
// selected-day row (the day, "היום", the count filters) over a full-bleed
// month grid; from lg the grid beside the 22rem day panel. The month itself
// isn't data, so it is drawn whole — this month's weeks, the dates, the Hebrew
// dates, the holidays and the parsha, today selected — and only the day's
// items and counts are blanks. Server-only (the Hebrew calendar stays off the
// client), for the route's loading screen.

// The he labels of CalendarView's week row and filters (calendarDict).
const WEEK_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const KIND_PILLS = [
  { label: "תזכורות", border: "border-info" },
  { label: "פרויקטים", border: "border-success" },
  { label: "משימות", border: "border-warning" },
  { label: "משלוחים", border: "border-palette-purple-4" },
];

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// fmtFullDay (components/ui/month-calendar) — that module is client-only.
function fullDay(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(d);
}

// The day's count filters (FilterToolbar), "הכל" active, counts blank.
function FilterPillsSkeleton() {
  const count = <Skeleton className="inline-block h-[0.75em] w-[0.6em] align-middle" />;
  return (
    <div className="flex flex-nowrap items-center justify-between gap-1 overflow-x-auto">
      <span className="flex shrink-0 items-center gap-1 rounded-full border-2 border-secondary bg-secondary/10 px-3 py-1 text-xs font-medium text-secondary">
        <span>הכל</span>
        <span className="font-bold">{count}</span>
      </span>
      {KIND_PILLS.map(({ label, border }) => (
        <span
          key={label}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full border-2 bg-background px-3 py-1 text-xs font-medium text-muted-foreground",
            border
          )}
        >
          <span>{label}</span>
          <span className="font-bold">{count}</span>
        </span>
      ))}
    </div>
  );
}

export default function CalendarSkeleton() {
  const [y, m, d] = israelDateKey().split("-").map(Number);
  const today = new Date(y, m - 1, d);
  const todayKey = isoLocal(today);

  // MonthBlock's grid: only the weeks this month spans.
  const first = new Date(y, m - 1, 1);
  const firstOffset = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const weeks = Math.ceil((firstOffset + daysInMonth) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => new Date(y, m - 1, 1 - firstOffset + i));
  const holidays = getHolidaysInRange(days[0], days[days.length - 1]);

  const hebShort = hebrewFullDate(today).replace(/\s+\S+$/, "");
  const parsha = hebrewParsha(today);
  const holiday = holidays.get(todayKey)?.name ?? null;

  return (
    <div className="-mb-24 space-y-3 md:mb-0" aria-busy="true">
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex h-[calc(100dvh-9.25rem)] min-w-0 flex-col md:block md:h-auto">
          {/* The phone's selected-day row. */}
          <div className="-mx-3 shrink-0 space-y-1.5 border-b bg-background px-2 py-1.5 lg:hidden">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="min-w-0 overflow-hidden whitespace-nowrap text-sm">
                <span className="font-semibold text-foreground">{fullDay(today)}</span>
                <span className="text-muted-foreground"> · {hebShort}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground">
                <CalendarIcon className="h-3.5 w-3.5" />
                היום
              </span>
            </div>
            <FilterPillsSkeleton />
          </div>

          <div className="relative -mx-3 min-h-0 flex-1 touch-none overflow-hidden border-b md:mx-0 md:h-[calc(100vh-11rem)] md:flex-none md:rounded-2xl md:border md:border-t">
            <div style={{ fontSize: "1rem" }} className="h-full">
              <section className="flex h-full flex-col">
                <div className="grid shrink-0 grid-cols-7 border-b bg-muted text-center text-[11px] font-medium text-muted-foreground">
                  {WEEK_DAYS.map((day) => (
                    <div key={day} className="overflow-hidden whitespace-nowrap px-0.5 py-1">
                      {day}
                    </div>
                  ))}
                </div>
                <div
                  className="grid min-h-0 flex-1 grid-cols-7 gap-px bg-border"
                  style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
                >
                  {days.map((day) => {
                    const key = isoLocal(day);
                    const inMonth = day.getMonth() === m - 1;
                    const isToday = key === todayKey;
                    const info = holidays.get(key);
                    const isMajor = Boolean(info?.major) && inMonth;
                    const dayParsha =
                      inMonth && day.getDay() === 6 ? (hebrewParsha(day)?.replace(/^פרשת\s+/, "") ?? null) : null;
                    return (
                      <div
                        key={key}
                        className={cn(
                          "relative flex flex-col gap-px overflow-hidden rounded px-0.5 pb-[1em] pt-[1.35em] text-start",
                          !inMonth ? "bg-secondary/5 text-muted-foreground" : isMajor ? "bg-muted/40" : "bg-background",
                          isToday && "z-10 ring-2 ring-inset ring-secondary"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute start-0.5 top-0.5 rounded-full px-1 text-[0.72em] font-medium leading-none",
                            isToday && "bg-primary py-0.5 text-primary-foreground"
                          )}
                        >
                          {day.getDate()}
                        </span>
                        <span className="absolute bottom-0.5 end-1 text-[0.6em] leading-none text-muted-foreground">
                          {hebrewDayLabel(day)}
                        </span>
                        {info?.name ? (
                          <span className="overflow-hidden whitespace-nowrap text-[0.55em] font-medium leading-tight text-primary/80">
                            {info.name}
                          </span>
                        ) : dayParsha ? (
                          <span className="overflow-hidden whitespace-nowrap text-[0.55em] leading-tight text-muted-foreground">
                            {dayParsha}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* lg+: the day panel — the day, its filters, its items, "add". */}
        <aside className="relative hidden min-w-0 lg:block">
          <div className="flex flex-col overflow-hidden rounded-2xl border shadow-card lg:absolute lg:inset-0 lg:overflow-y-auto">
            <div className="border-b bg-secondary/5 px-4 py-3">
              <div className="mb-2">
                <div className="font-semibold">{fullDay(today)}</div>
                <div className="text-xs text-muted-foreground">
                  {hebShort}
                  {parsha ? ` · ${parsha}` : ""}
                  {holiday ? ` · ${holiday}` : ""}
                </div>
              </div>
              <FilterPillsSkeleton />
            </div>
            <div className="flex-1 bg-card p-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-xl border border-e-2 bg-background p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex h-6 min-w-0 flex-1 items-center">
                          <Skeleton className="h-4 w-3/4" />
                        </div>
                        <Skeleton className="mt-1.5 h-2.5 w-10 shrink-0" />
                      </div>
                      <div className="mt-0.5 flex h-4 items-center">
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
                <span className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-secondary/40 py-2.5 text-sm font-medium text-secondary">
                  <AddIcon className="h-4 w-4" />
                  הוספה ליום זה
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
