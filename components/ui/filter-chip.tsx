"use client";

// The shared size of every control in a toolbar row (chips, selects, the
// alerts chip) so they sit on one baseline.
export const TOOLBAR_CONTROL = "h-[34px] rounded-lg border";

// A filter chip — the app's control for an on/off filter, `aria-pressed`. ON
// fills solid sky and OFF is a plain outline: a view's contents depend on
// these, so their state has to read at a glance, not from a tint.
export function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center px-3 text-xs font-semibold transition-colors ${TOOLBAR_CONTROL} ${
        active
          ? "border-secondary bg-secondary text-secondary-foreground hover:bg-secondary/90"
          : "border-input bg-background text-muted-foreground hover:bg-secondary/5 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
