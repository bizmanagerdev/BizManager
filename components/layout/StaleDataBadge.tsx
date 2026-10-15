"use client";

import { OfflineIcon } from "@/components/ui/icons";
import { formatDayMonth, formatTimeOnly } from "@/lib/date";
import { israelDateKey } from "@/lib/timezone";

// Israel's day and clock, not the device's.
function formatSavedAt(savedAt: number | null): string {
  if (!savedAt) return "";
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  const time = formatTimeOnly(iso, "");
  if (israelDateKey(d) === israelDateKey()) return `עודכן ${time}`;
  return `עודכן ${formatDayMonth(iso, "")} ${time}`;
}

/**
 * Small "you're seeing offline data captured at HH:MM" cue. Rendered next to a
 * dataset that is being served from an offline snapshot, so a user never mistakes
 * cached data for live numbers.
 */
export default function StaleDataBadge({ savedAt, className }: { savedAt: number | null; className?: string }) {
  const when = formatSavedAt(savedAt);
  return (
    <span
      dir="rtl"
      className={`inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft/60 px-2 py-0.5 text-xs text-warning-soft-foreground ${className ?? ""}`}
    >
      <OfflineIcon className="h-3 w-3" />
      <span>לא מקוון{when ? ` · ${when}` : ""}</span>
    </span>
  );
}
