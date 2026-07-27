"use client";

import { useState } from "react";
import CalendarTimeline from "@/app/(app)/calendar/CalendarTimeline";
import CalendarView from "@/app/(app)/calendar/CalendarView";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import type { CalendarEntry } from "@/lib/projectSchedule";

type Scope = "mine" | "all";
type View = "timeline" | "calendar";

export default function CalendarSection({
  entries,
  allEntries = null,
  todayIso,
}: {
  entries: CalendarEntry[];
  /** When provided (admin/office), enables the שלי/הכל scope toggle. */
  allEntries?: CalendarEntry[] | null;
  todayIso: string;
}) {
  const [view, setView] = useState<View>("calendar");
  const [scope, setScope] = useState<Scope>("mine");

  const canToggleScope = allEntries !== null;
  const shownEntries = scope === "all" && allEntries ? allEntries : entries;

  const toggleProps = {
    scope,
    view,
    canToggleScope,
    onScope: setScope,
    onView: setView,
  };

  return (
    <div className="space-y-4">
      {/* Mobile: the controls live INSIDE the dark page-header bar (same slot the
          projects page uses), so they read as part of the header. The track is a
          subtle lighter shade so it shows against the navy header. */}
      <PageHeaderToolbar>
        <div className="flex w-full items-center">
          <ScopeViewToggle {...toggleProps} tone="header" />
        </div>
      </PageHeaderToolbar>

      {/* Desktop: the header bar is hidden, so the same control sits on the page —
          a solid navy pill so it stays legible on the light surface. */}
      <div className="hidden md:block">
        <ScopeViewToggle {...toggleProps} tone="page" />
      </div>

      {view === "timeline" ? (
        <div className="space-y-3">
          {/* Calendar mode sets its own (selected-day) title from CalendarView;
              timeline mode shows the total instead. */}
          <TimelineTitle count={shownEntries.length} />
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <LegendDot color="bg-warning" label="משימה" />
            <LegendDot color="bg-info" label="תזכורת" />
            <LegendDot color="bg-success" label="פרויקט מתחיל" />
            <LegendDot color="bg-destructive" label="פרויקט מסתיים" />
          </div>
          <CalendarTimeline entries={shownEntries} todayIso={todayIso} days={21} />
        </div>
      ) : (
        <CalendarView entries={shownEntries} todayIso={todayIso} />
      )}
    </div>
  );
}

function TimelineTitle({ count }: { count: number }) {
  useSetPageTitle("יומן", `${count} ${count === 1 ? "פריט" : "פריטים"}`);
  return null;
}

// One dark segmented control: scope שלי/הכל + a view switch that flips its label
// between ציר זמן and לוח חודשי. On the dark header the track is a subtle lighter
// shade; segments share the width (flex-1) on mobile so nothing is cut off, and
// shrink to content from md up.
function ScopeViewToggle({
  scope,
  view,
  canToggleScope,
  onScope,
  onView,
  tone,
}: {
  scope: Scope;
  view: View;
  canToggleScope: boolean;
  onScope: (next: Scope) => void;
  onView: (next: View) => void;
  /** "header" = sits on the navy header (subtle track); "page" = a solid navy
   *  pill for the light page surface. */
  tone: "header" | "page";
}) {
  const track = tone === "header" ? "bg-white/10" : "bg-sidebar";
  return (
    <div
      className={`flex w-full items-center gap-1 rounded-full ${track} p-1 text-sm text-sidebar-foreground md:w-fit`}
    >
      {canToggleScope && (
        <>
          <SegButton active={scope === "mine"} onClick={() => onScope("mine")}>
            שלי
          </SegButton>
          <SegButton active={scope === "all"} onClick={() => onScope("all")}>
            הכל
          </SegButton>
        </>
      )}
      {/* A switch, not a state: it always shows the OTHER view you can jump to, so
          it never carries the active pill (only the scope does). */}
      <SegButton active={false} onClick={() => onView(view === "timeline" ? "calendar" : "timeline")}>
        {view === "timeline" ? "לוח חודשי" : "ציר זמן"}
      </SegButton>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 whitespace-nowrap rounded-full px-4 py-1.5 text-center font-medium transition-colors md:flex-none ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
