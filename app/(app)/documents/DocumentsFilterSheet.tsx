"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// ────────────────────────────────────────────────────────────────────────────
// Every filter the page has, on one sheet.
//
// On a phone the five dropdowns wrapped onto three rows and ate the screen
// before a single photograph appeared. They are the same choices here, stacked
// and reachable with a thumb, behind one button that says how many are on.
//
// Not a set of dropdowns-in-a-sheet: a menu inside a sheet is two layers of
// dismissal for one decision. Each facet is just a list you tap.
// ────────────────────────────────────────────────────────────────────────────

export type SheetFacet = {
  key: string;
  label: string;
  count?: number;
};

function FacetSection({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: SheetFacet[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs text-[rgb(var(--primary-6))]">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.has(option.key);
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onToggle(option.key)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
                on
                  ? "border-secondary bg-secondary/10 text-secondary"
                  : "border-border bg-background text-foreground"
              }`}
            >
              <span>{option.label}</span>
              {typeof option.count === "number" ? (
                <span className="text-xs text-muted-foreground">{option.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A single-choice row — grouping and sorting are one-of, not many-of. */
function ChoiceSection({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Record<string, string>;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs text-[rgb(var(--primary-6))]">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(options).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors ${
              value === key
                ? "border-secondary bg-secondary/10 text-secondary"
                : "border-border bg-background text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function DocumentsFilterSheet({
  open,
  onOpenChange,
  scopeOptions,
  attachedTo,
  onToggleScope,
  expiryOptions,
  expiryChips,
  onToggleExpiry,
  typeOptions,
  typeChips,
  onToggleType,
  groupByOptions,
  groupBy,
  onGroupBy,
  sortByOptions,
  sortBy,
  onSortBy,
  resultCount,
  hasActiveFilters,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeOptions: SheetFacet[];
  attachedTo: Set<string>;
  onToggleScope: (key: string) => void;
  expiryOptions: SheetFacet[];
  expiryChips: Set<string>;
  onToggleExpiry: (key: string) => void;
  typeOptions: SheetFacet[];
  typeChips: Set<string>;
  onToggleType: (key: string) => void;
  groupByOptions: Record<string, string>;
  groupBy: string;
  onGroupBy: (key: string) => void;
  sortByOptions: Record<string, string>;
  sortBy: string;
  onSortBy: (key: string) => void;
  resultCount: number;
  hasActiveFilters: boolean;
  onClear: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col gap-0 rounded-t-2xl p-0"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3 text-start">
          <SheetTitle>סינון</SheetTitle>
        </SheetHeader>

        {/* The sheet is capped; this is the part that scrolls, so the button at
            the bottom stays reachable however many categories exist. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <FacetSection
            title="שיוך"
            options={scopeOptions}
            selected={attachedTo}
            onToggle={onToggleScope}
          />
          <FacetSection
            title="תוקף"
            options={expiryOptions}
            selected={expiryChips}
            onToggle={onToggleExpiry}
          />
          <FacetSection
            title="סוג"
            options={typeOptions}
            selected={typeChips}
            onToggle={onToggleType}
          />
          <ChoiceSection
            title="קיבוץ"
            options={groupByOptions}
            value={groupBy}
            onChange={onGroupBy}
          />
          <ChoiceSection title="מיון" options={sortByOptions} value={sortBy} onChange={onSortBy} />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
          <Button type="button" className="flex-1" onClick={() => onOpenChange(false)}>
            הצג {resultCount} תוצאות
          </Button>
          {hasActiveFilters ? (
            <Button type="button" variant="link" className="h-auto p-0" onClick={onClear}>
              נקה הכל
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
