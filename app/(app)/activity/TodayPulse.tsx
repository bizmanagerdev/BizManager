"use client";

import { useEffect, useState, type ReactNode } from "react";
import { OrderIcon, PaymentIcon, SuccessIcon, TimerIcon, type IconComponent } from "@/components/ui/icons";
import type { ActivityToday } from "@/lib/activity/today";
import { formatWorkedMinutes } from "@/lib/activity/today";
import { israelParts } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// "היום בעסק" — the day at a glance, at the top of the activity page: the
// money that came in, the orders opened, the tasks done, the hours worked, and
// how the day's actions spread over its hours. Each number is also a way in:
// tapping it shows only those actions below.

function shekels(n: number) {
  return `₪${Math.round(n).toLocaleString("he-IL")}`;
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  tint,
  active,
  onClick,
  children,
}: {
  icon: IconComponent;
  label: string;
  value: ReactNode;
  sub: string;
  tint: string;
  active: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col items-start gap-0.5 rounded-xl border p-2.5 text-start transition-colors",
        active ? "border-secondary bg-secondary/10 ring-1 ring-secondary" : "border-border/60 bg-background hover:bg-accent/40"
      )}
    >
      <span className="flex w-full items-start gap-1.5 text-xs leading-tight text-muted-foreground">
        <span className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full", tint)}>
          <Icon className="h-3 w-3" strokeWidth={2.4} />
        </span>
        {/* Wraps at a big text size rather than being cut off. */}
        <span className="min-w-0 self-center break-words">{label}</span>
      </span>
      <span className="text-lg font-bold leading-tight tabular-nums text-foreground sm:text-xl">{value}</span>
      <span className="w-full text-[0.647rem] leading-snug text-muted-foreground">{sub}</span>
      {children}
    </button>
  );
}

/** The hours a day's ribbon spans: the working day, stretched to the day's first and last action and to now. */
export function ribbonHours(hourly: number[], nowHour: number | null): number[] {
  let first = 7;
  let last = 18;
  hourly.forEach((n, h) => {
    if (n > 0) {
      first = Math.min(first, h);
      last = Math.max(last, h);
    }
  });
  if (nowHour !== null) {
    first = Math.min(first, nowHour);
    last = Math.max(last, nowHour);
  }
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function HourRibbon({
  hourly,
  nowHour,
  size = "md",
}: {
  hourly: number[];
  nowHour: number | null;
  size?: "sm" | "md";
}) {
  const hours = ribbonHours(hourly, nowHour);
  const max = Math.max(1, ...hours.map((h) => hourly[h] ?? 0));
  const peak = hours.reduce((best, h) => ((hourly[h] ?? 0) > (hourly[best] ?? 0) ? h : best), hours[0]);
  const pad = (h: number) => String(h).padStart(2, "0");
  // "14:00 עד 15:00", not "14:00–15:00": between two times, only a word keeps
  // right-to-left text from printing them the other way round.
  const span = (h: number) => `${pad(h)}:00 עד ${pad((h + 1) % 24)}:00`;
  const summary =
    (hourly[peak] ?? 0) > 0 ? `השעה העמוסה: ${span(peak)} · ${hourly[peak]} פעולות` : "עוד לא היו פעולות היום";

  return (
    <div>
      {/* Hours run right to left, the way Hebrew reads (and the week runs in the calendar). */}
      <div
        role="img"
        aria-label={summary}
        className={cn("flex items-end gap-[3px]", size === "md" ? "h-14" : "h-8")}
      >
        {hours.map((h) => {
          const n = hourly[h] ?? 0;
          const isNow = h === nowHour;
          const future = nowHour !== null && h > nowHour;
          return (
            <div
              key={h}
              title={`${span(h)} · ${n} פעולות`}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <div
                className={cn(
                  "w-full rounded-t-[3px] transition-[height] duration-500",
                  future
                    ? "bg-muted"
                    : isNow
                      ? "bg-secondary"
                      : h === peak && n > 0
                        ? "bg-accentSky-6"
                        : "bg-accentSky-8"
                )}
                style={{ height: n > 0 ? `${Math.max(8, (n / max) * 100)}%` : "2px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px] text-[0.588rem] tabular-nums text-muted-foreground">
        {hours.map((h) => (
          <span key={h} className={cn("min-w-0 flex-1 text-center", h === nowHour && "font-semibold text-secondary")}>
            {h === nowHour ? "עכשיו" : h % 3 === 0 ? pad(h) : ""}
          </span>
        ))}
      </div>
      {size === "md" ? <p className="mt-1 text-xs text-muted-foreground">{summary}</p> : null}
    </div>
  );
}

/** The current hour on an Israeli clock, kept fresh while the page stays open. */
export function useIsraelHour(): number | null {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setHour(israelParts(new Date()).hour);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return hour;
}

export default function TodayPulse({
  today,
  live,
  activeTable,
  onPickTable,
}: {
  today: ActivityToday;
  live: boolean;
  activeTable: string;
  onPickTable: (table: string) => void;
}) {
  const nowHour = useIsraelHour();
  const { money, orders, tasks, hours } = today;
  const pick = (table: string) => onPickTable(activeTable === table ? "" : table);
  const methods = money.methods
    .slice(0, 2)
    .map((m) => `${m.label} ${shekels(m.total)}`)
    .join(" · ");
  const tasksLeft = Math.max(0, tasks.of - tasks.done);

  return (
    <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm sm:p-4" aria-label="היום בעסק">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">היום בעסק</h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="מתעדכן לבד">
          <span className="relative flex h-2 w-2">
            {live ? (
              <span className="absolute inline-flex h-full w-full rounded-full bg-success-soft-foreground/60 motion-safe:animate-ping" />
            ) : null}
            <span className={cn("relative inline-flex h-2 w-2 rounded-full", live ? "bg-success-soft-foreground" : "bg-muted-foreground/50")} />
          </span>
          {live ? "חי" : "מתחבר…"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile
          icon={PaymentIcon}
          label="נכנס היום"
          tint="bg-palette-green-9 text-palette-green-4"
          value={<span className={money.total > 0 ? "text-palette-green-4" : undefined}>{shekels(money.total)}</span>}
          sub={money.count ? `${money.count === 1 ? "תשלום אחד" : `${money.count} תשלומים`}${methods ? ` · ${methods}` : ""}` : "עוד לא נכנס תשלום"}
          active={activeTable === "payments"}
          onClick={() => pick("payments")}
        />
        <Tile
          icon={OrderIcon}
          label="הזמנות חדשות"
          tint="bg-palette-blue-9 text-palette-blue-4"
          value={orders.count.toLocaleString("he-IL")}
          sub={orders.count ? `בסך ${shekels(orders.total)}` : "עוד לא נפתחה הזמנה"}
          active={activeTable === "orders"}
          onClick={() => pick("orders")}
        />
        <Tile
          icon={SuccessIcon}
          label="משימות שבוצעו"
          tint="bg-palette-purple-9 text-palette-purple-4"
          value={
            <span>
              {tasks.done.toLocaleString("he-IL")}
              {tasks.of > 0 ? <span className="text-sm font-medium text-muted-foreground">{` / ${tasks.of}`}</span> : null}
            </span>
          }
          sub={tasks.of === 0 ? "אין משימות להיום" : tasksLeft === 0 ? "הכול בוצע" : `נשארו ${tasksLeft} להיום`}
          active={activeTable === "tasks"}
          onClick={() => pick("tasks")}
        >
          {tasks.of > 0 ? (
            <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <span
                className="block h-full rounded-full bg-palette-purple-4 transition-[width] duration-500"
                style={{ width: `${Math.round((tasks.done / tasks.of) * 100)}%` }}
              />
            </span>
          ) : null}
        </Tile>
        <Tile
          icon={TimerIcon}
          label="שעות עבודה"
          tint="bg-accentSky-10 text-accentSky-6"
          value={hours.minutes > 0 ? formatWorkedMinutes(hours.minutes) : "0"}
          sub={
            hours.workers
              ? `${hours.workers === 1 ? "עובד אחד" : `${hours.workers} עובדים`}${hours.onShiftNow ? ` · ${hours.onShiftNow} בשעון עכשיו` : ""}`
              : "אף אחד עוד לא נכנס לשעון"
          }
          active={activeTable === "attendance_sessions"}
          onClick={() => pick("attendance_sessions")}
        />
      </div>

      <div className="mt-3">
        <HourRibbon hourly={today.hourly} nowHour={nowHour} />
      </div>
    </section>
  );
}
