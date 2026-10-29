import type { NavCount } from "@/lib/ui/nav-counts-store";
import { cn } from "@/lib/utils";

// The menu's count badges, coloured by the most urgent open item behind them.

function badgeTone(severity: NavCount["severity"]) {
  return severity === "danger"
    ? "bg-destructive text-destructive-foreground"
    : severity === "warning"
      ? "bg-warning text-warning-foreground"
      : "bg-sidebar-accent text-sidebar-accent-foreground";
}

function label(count: number) {
  return count > 99 ? "99+" : count;
}

/** The side menu's pill, at the end of the row. */
export function NavCountBadge({ badge, collapsed }: { badge: NavCount; collapsed: boolean }) {
  return (
    <span
      className={cn(
        "ms-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none",
        badgeTone(badge.severity),
        // When icons-only, float the pill as a small dot-count over the icon.
        collapsed ? "hidden" : "inline-flex"
      )}
    >
      {label(badge.count)}
    </span>
  );
}

/**
 * The phone's: on the top-left corner of a bottom-menu item or an "עוד" tile —
 * physical left, as the owner asked (2026-10-29), not the reading side. Fixed px
 * like the rest of the bottom menu, so a big text size doesn't blow it up; a
 * ring in the menu's navy keeps it apart from the icon it sits on.
 */
export function NavCountCorner({ badge }: { badge: NavCount }) {
  return (
    <span
      data-nav-count
      className={cn(
        "pointer-events-none absolute -left-2.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums ring-2 ring-sidebar",
        badgeTone(badge.severity)
      )}
    >
      {label(badge.count)}
    </span>
  );
}
