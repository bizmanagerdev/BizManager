"use client";

// The shared size of every control in a toolbar row (chips, selects, the
// alerts chip) so they sit on one baseline.
export const TOOLBAR_CONTROL = "h-[34px] rounded-lg border";

/**
 * THE look of a selected toggle, everywhere: filter chips, segmented "this or
 * that" controls, pick-one chips (owner, 2026-10-11: "toggle buttons should
 * always be the same style"). ON is a solid blue (secondary) fill with white
 * text — "all the toggles should be blue not navy" (the owner tried navy the
 * same day and changed his mind); OFF is quiet. A view's contents depend on
 * these, so their state has to read at a glance, not from a tint.
 */
export const TOGGLE_ON = "bg-secondary text-secondary-foreground shadow-sm";
/** The same fill as a hover, for a toggle that is a <button>. */
export const TOGGLE_ON_HOVER = "hover:bg-secondary/90";
export const TOGGLE_OFF = "text-muted-foreground hover:bg-accent/60 hover:text-foreground";

/** A segmented control's frame and each of its segments ("לקוח קיים | לקוח חדש"). */
export const SEGMENTED_GROUP = "inline-flex rounded-2xl border border-border/60 bg-background/70 p-1 shadow-sm";
export const SEGMENT = "rounded-xl px-4 py-2 text-sm font-medium transition-colors";

// A filter chip — the app's control for an on/off filter, `aria-pressed`. ON
// is the blue toggle fill above and OFF a plain outline.
export function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center px-3 text-xs font-semibold transition-colors ${TOOLBAR_CONTROL} ${
        active
          ? `border-secondary ${TOGGLE_ON} ${TOGGLE_ON_HOVER}`
          : "border-input bg-background text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      {label}
      {/* Present only when the filter is ON: the clearest possible signal that
          the view is narrowed, and the way to widen it again. A view showing
          fewer rows for no visible reason reads as missing data. */}
      {active ? <span aria-hidden className="ms-1.5 text-sm leading-none opacity-80">×</span> : null}
    </button>
  );
}
