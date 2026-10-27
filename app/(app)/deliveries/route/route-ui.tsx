import { SEGMENT, SEGMENTED_GROUP, TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { cityColour } from "@/lib/deliveries/city-colours";
import { israelDateKey, israelParts, israelWallClockToUtc } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// What the planner and the drive both draw.

/** "08:30", Israel time. */
export function clock(iso: string): string {
  const p = israelParts(new Date(iso));
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * "08:30" today, "מחר 08:30" tomorrow, "29/10 08:30" later — Israel time. An
 * hour already gone is planned for tomorrow, and the screen has to say so
 * (found testing 2026-10-27: "07:00" planned for the next morning read "07:00").
 */
export function dayClock(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const day = israelDateKey(at);
  const today = israelParts(now);
  if (day === israelDateKey(now)) return clock(iso);
  const noonTomorrow = new Date(israelWallClockToUtc(today.year, today.month, today.day, 12, 0).getTime() + 24 * 3600_000);
  if (day === israelDateKey(noonTomorrow)) return `מחר ${clock(iso)}`;
  const p = israelParts(at);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")} ${clock(iso)}`;
}

/** A chosen "HH:MM" that has passed (by more than five minutes) is tomorrow's — as departureFrom plans it. */
export function leavesTomorrow(time: string, nowClock: string): boolean {
  const minutes = (hm: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const at = minutes(time);
  const now = minutes(nowClock);
  return at !== null && now !== null && at < now - 5;
}

/** "הרצל 5, ירושלים" — the city added when the address line doesn't name it. */
export function placeLine(stop: { address: string; city: string }): string {
  return [stop.address, stop.address.includes(stop.city) ? null : stop.city].filter(Boolean).join(", ");
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn(SEGMENTED_GROUP, "flex w-full", className)} role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(SEGMENT, "flex-1 px-2 text-center", value === option.value ? TOGGLE_ON : TOGGLE_OFF)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CityDot({ city, className }: { city: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: cityColour(city) }} />;
}
