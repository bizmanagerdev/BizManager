"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Optional secondary text shown under the label and included in the search. */
  hint?: string | null;
};

/**
 * Searchable single-select dropdown for flat option lists (drop-in replacement
 * for a native <select> that lists "all customers" / "all projects" / etc.).
 *
 * Options are rendered in the order they are passed — sort them before handing
 * them over (customers alphabetically, projects by closest date, …). When an
 * `emptyOptionLabel` is given, a clear/"all" row mapped to value="" is added on
 * top so it can stand in for the native <option value="">כל ה…</option> row.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "בחירה...",
  searchPlaceholder = "חיפוש...",
  emptyOptionLabel,
  noResultsLabel = "לא נמצאו תוצאות.",
  disabled = false,
  ariaLabel,
  className,
  maxHeightClassName = "max-h-64",
  /** Only render the search box once the list is long enough to need it. */
  searchThreshold = 6,
}: {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyOptionLabel?: string;
  noResultsLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  maxHeightClassName?: string;
  searchThreshold?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

  const showSearch = options.length > searchThreshold;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        (option.hint ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  function pick(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }

  const triggerLabel = selected?.label ?? emptyOptionLabel ?? placeholder;
  const isPlaceholder = !selected && !emptyOptionLabel;

  return (
    <div
      className="relative"
      onBlur={(e) => {
        // Close only when focus leaves the whole control (not when it moves from
        // the trigger to the search input / an option inside the dropdown).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background/80 px-4 py-2 text-right text-sm shadow-sm transition-all duration-200 focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", isPlaceholder && "text-muted-foreground")}>
          {triggerLabel}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && !disabled ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border bg-background shadow-lg">
          {showSearch ? (
            <div className="relative border-b p-2">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="pe-9"
              />
              <Search className="pointer-events-none absolute end-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          ) : null}

          <div className={cn("overflow-auto p-1", maxHeightClassName)}>
            {emptyOptionLabel && !query.trim() ? (
              <button
                type="button"
                onClick={() => pick("")}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm hover:bg-muted",
                  value === "" && "bg-primary/5"
                )}
              >
                {value === "" ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 text-muted-foreground">{emptyOptionLabel}</span>
              </button>
            ) : null}

            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{noResultsLabel}</div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => pick(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm hover:bg-muted",
                    value === option.value && "bg-primary/5"
                  )}
                >
                  {value === option.value ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.hint ? (
                      <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
