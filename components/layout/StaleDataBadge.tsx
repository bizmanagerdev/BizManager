"use client";

import { OfflineIcon } from "@/components/ui/icons";

function formatSavedAt(savedAt: number | null): string {
  if (!savedAt) return "";
  try {
    const d = new Date(savedAt);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return `עודכן ${time}`;
    return `עודכן ${d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })} ${time}`;
  } catch {
    return "";
  }
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
