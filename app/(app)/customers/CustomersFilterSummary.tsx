"use client";

import { Button } from "@/components/ui/button";

// What the closed filter panel is narrowing the list by — the projects list's
// summary line — with the way to widen it again. Shown at every width: the
// selects are behind the toggle on the computer too. The loading placeholder
// draws the same line from the address, so it's there from the first frame.

export function CustomersFilterSummaryLine({ summary, onClear }: { summary: string; onClear?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0">{summary}</span>
      {/* A text button the size of the line, its tap area reaching past it
          (the negative margin) so the line stays as short as the summary. */}
      <Button
        type="button"
        variant="link"
        className="-my-2.5 h-auto shrink-0 px-1 py-2.5 text-xs disabled:opacity-100"
        onClick={onClear}
        disabled={!onClear}
      >
        נקה סינון
      </Button>
    </div>
  );
}
