"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Optional secondary text shown under the label and included in the search. */
  hint?: string | null;
  /** Optional leading icon shown before the label (in the trigger and the row). */
  icon?: ReactNode;
};

/**
 * Searchable single-select dropdown for flat option lists (drop-in replacement
 * for a native <select> that lists "all customers" / "all projects" / etc.).
 *
 * Options are rendered in the order they are passed — sort them before handing
 * them over (customers alphabetically, projects by closest date, …). When an
 * `emptyOptionLabel` is given, a clear/"all" row mapped to value="" is added on
 * top so it can stand in for the native <option value="">כל ה…</option> row.
 *
 * The menu is rendered through a Radix Popover, so it is never clipped by an
 * ancestor's `overflow` (e.g. a scrollable dialog body), flips when there isn't
 * room below, and nests correctly inside a Radix Dialog (focus + dismissal).
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
  const searchRef = useRef<HTMLInputElement>(null);
  const listCleanup = useRef<(() => void) | null>(null);

  // When this select opens inside a Radix Dialog, the dialog locks body scroll
  // via react-remove-scroll, which installs document-level wheel/touchmove
  // listeners that cancel scrolling on anything outside the dialog's subtree.
  // This menu is portaled to <body> (outside that subtree), so without this the
  // list would only scroll by dragging the scrollbar — not with a wheel or a
  // finger. Stopping the events at the list container keeps them from reaching
  // that document listener, so native scrolling of the list works again. A
  // callback ref (not an effect) attaches the listeners the instant the list
  // node mounts, so portal/animation timing can never leave it unbound.
  const listRef = useCallback((node: HTMLDivElement | null) => {
    listCleanup.current?.();
    listCleanup.current = null;
    if (!node) return;
    const stop = (event: Event) => event.stopPropagation();
    node.addEventListener("wheel", stop, { passive: true });
    node.addEventListener("touchmove", stop, { passive: true });
    listCleanup.current = () => {
      node.removeEventListener("wheel", stop);
      node.removeEventListener("touchmove", stop);
    };
  }, []);

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
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background/80 px-4 py-2 text-right text-sm shadow-sm transition-all duration-200 focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("flex min-w-0 flex-1 items-center gap-2 truncate", isPlaceholder && "text-muted-foreground")}>
            {selected?.icon ? <span className="shrink-0 text-muted-foreground">{selected.icon}</span> : null}
            <span className="min-w-0 truncate">{triggerLabel}</span>
          </span>
          <ChevronDown className="h-6 w-6 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          // Keep the menu the width of the trigger and bounded to the space the
          // Popover has on screen, so it scrolls internally instead of overflowing.
          style={{
            width: "var(--radix-popover-trigger-width)",
            maxHeight: "var(--radix-popover-content-available-height)",
          }}
          // Focus the search box (if shown) on open instead of the content shell.
          onOpenAutoFocus={(event) => {
            if (showSearch && searchRef.current) {
              event.preventDefault();
              searchRef.current.focus();
            }
          }}
          className="z-[60] flex flex-col overflow-hidden rounded-xl border bg-background shadow-lg"
        >
          {showSearch ? (
            <div className="relative border-b p-2">
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="pe-9"
              />
              <Search className="pointer-events-none absolute end-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          ) : null}

          <div ref={listRef} className={cn("overflow-auto overscroll-contain p-1", maxHeightClassName)}>
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
                  {option.icon ? <span className="shrink-0 text-muted-foreground">{option.icon}</span> : null}
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
