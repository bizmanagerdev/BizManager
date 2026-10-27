import { SEGMENT, SEGMENTED_GROUP, TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { cityColour } from "@/lib/deliveries/city-colours";
import { israelParts } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// What the planner and the drive both draw.

/** "08:30", Israel time. */
export function clock(iso: string): string {
  const p = israelParts(new Date(iso));
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
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
