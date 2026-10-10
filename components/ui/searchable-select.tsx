"use client";

import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "@/components/ui/icons";
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
 *
 * Works from the keyboard (owner, 2026-10-09 — the account picker didn't): down
 * or Enter on the closed field opens it, typing a letter there opens it
 * searching for it, up/down move through the rows (the search box keeps the
 * focus), Enter picks the highlighted row — the top match while searching —
 * and Escape closes. Focus then returns to the field, so Tab goes on.
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
  // The highlighted row (keyboard), an index into `rows` below.
  const [active, setActive] = useState(0);
  const listId = useId();
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

  // Every row in the list, in order: the "none" row (when shown), then the matches.
  const rows = useMemo(
    () => [...(emptyOptionLabel && !query.trim() ? [""] : []), ...filtered.map((option) => option.value)],
    [emptyOptionLabel, query, filtered]
  );
  const rowId = (index: number) => `${listId}-row-${index}`;

  function pick(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }

  function openWith(nextQuery: string) {
    setQuery(nextQuery);
    // The current choice highlighted on open; the top match when searching.
    const current = nextQuery ? -1 : rows.indexOf(value);
    setActive(current >= 0 ? current : 0);
    setOpen(true);
  }

  function moveTo(index: number) {
    if (rows.length === 0) return;
    const next = (index + rows.length) % rows.length;
    setActive(next);
    document.getElementById(rowId(next))?.scrollIntoView({ block: "nearest" });
  }

  // While open: arrows move the highlight, Enter picks it (wherever the focus
  // is inside the menu — the search box keeps it while typing).
  function onMenuKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(active - 1);
    } else if (event.key === "Home" && !showSearch) {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === "End" && !showSearch) {
      event.preventDefault();
      moveTo(rows.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (rows[active] !== undefined) pick(rows[active]);
    }
  }

  // The closed field: down opens it; a typed letter opens it searching for that letter.
  function onTriggerKeyDown(event: KeyboardEvent) {
    if (disabled || open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openWith("");
    } else if (showSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      event.preventDefault();
      openWith(event.key);
    }
  }

  const triggerLabel = selected?.label ?? emptyOptionLabel ?? placeholder;
  const isPlaceholder = !selected && !emptyOptionLabel;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) openWith("");
        else {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background/80 px-4 py-2 text-right text-sm shadow-sm transition-all duration-200 focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("flex min-w-0 flex-1 items-center gap-2", isPlaceholder && "text-muted-foreground")}>
            {selected?.icon ? <span className="shrink-0 text-muted-foreground">{selected.icon}</span> : null}
            <span className="min-w-0">{triggerLabel}</span>
          </span>
          <ChevronDownIcon className="h-6 w-6 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          // At LEAST as wide as the trigger, but free to grow to whatever the
          // longest option needs — a narrow trigger used to clip every label to
          // "נ...". Bounded by the space on screen, so it scrolls internally
          // instead of overflowing.
          style={{
            minWidth: "var(--radix-popover-trigger-width)",
            maxWidth: "min(28rem, var(--radix-popover-content-available-width))",
            maxHeight: "var(--radix-popover-content-available-height)",
          }}
          // Focus the search box (if shown) on open instead of the content shell.
          onOpenAutoFocus={(event) => {
            if (showSearch && searchRef.current) {
              event.preventDefault();
              searchRef.current.focus();
            }
          }}
          onKeyDown={onMenuKeyDown}
          className="z-[60] flex flex-col overflow-hidden rounded-xl border bg-background shadow-lg"
        >
          {showSearch ? (
            <div className="relative border-b p-2">
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0); // the top match, ready for Enter
                }}
                placeholder={searchPlaceholder}
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={rows.length > 0 ? rowId(active) : undefined}
                className="pe-9"
              />
              <SearchIcon className="pointer-events-none absolute end-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          ) : null}

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className={cn("overflow-auto overscroll-contain p-1", maxHeightClassName)}
          >
            {emptyOptionLabel && !query.trim() ? (
              <button
                type="button"
                id={rowId(0)}
                role="option"
                aria-selected={value === ""}
                onClick={() => pick("")}
                onMouseMove={() => setActive(0)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm hover:bg-muted",
                  value === "" && "bg-primary/5",
                  active === 0 && "bg-muted"
                )}
              >
                {value === "" ? (
                  <CheckIcon className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 text-muted-foreground">{emptyOptionLabel}</span>
              </button>
            ) : null}

            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{noResultsLabel}</div>
            ) : (
              filtered.map((option, index) => {
                const row = index + rows.length - filtered.length;
                return (
                  <button
                    key={option.value}
                    type="button"
                    id={rowId(row)}
                    role="option"
                    aria-selected={value === option.value}
                    onClick={() => pick(option.value)}
                    onMouseMove={() => setActive(row)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm hover:bg-muted",
                      value === option.value && "bg-primary/5",
                      active === row && "bg-muted"
                    )}
                  >
                    {value === option.value ? (
                      <CheckIcon className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    {option.icon ? <span className="shrink-0 text-muted-foreground">{option.icon}</span> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{option.label}</span>
                      {option.hint ? (
                        <span className="block text-xs text-muted-foreground">{option.hint}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
