import type { ReactNode } from "react";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Pieces for the pages' loading screens, each built from the real piece's own
// classes, so a page's placeholder IS that page's shape — its tab bar, its
// toolbar, its table or cards — and nothing moves when the page arrives
// (owner, 2026-10-09: every page's loading view in its real page's structure,
// on a phone and on a desktop). Server-safe: no hooks, no client code.

/**
 * An underline tab bar (TabsList variant="underline", components/ui/tabs.tsx)
 * with the page's own tab names — the bar's words are known before its data.
 * `active`: the open tab's index. `counts`: which tabs carry a count pill.
 */
export function UnderlineTabsSkeleton({
  labels,
  active = 0,
  counts = [],
  className,
  triggerClassName,
}: {
  labels: readonly ReactNode[];
  active?: number;
  counts?: readonly boolean[];
  className?: string;
  triggerClassName?: string;
}) {
  return (
    <div
      dir="rtl"
      className={cn(
        "inline-flex h-auto w-full items-center justify-start gap-2 overflow-x-auto overflow-y-hidden border-b border-border/60 bg-transparent p-0 text-muted-foreground sm:gap-3",
        className
      )}
    >
      {labels.map((label, i) => (
        <span
          key={i}
          className={cn(
            "-mb-px inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-t-md border-b-[3px] border-transparent bg-transparent px-2 pb-2 pt-1 text-base font-medium text-muted-foreground",
            i === active && "border-primary font-bold text-primary",
            triggerClassName
          )}
        >
          {label}
          {counts[i] ? <CountSkeleton /> : null}
        </span>
      ))}
    </div>
  );
}

/** A count pill (CountBadge) whose number isn't known yet. */
export function CountSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-4 w-5 shrink-0 rounded-full", className)} />;
}

/**
 * A list page's desktop table (DataTableShell) with the page's own column
 * names and rows of placeholders. `rowClassName` sets the real rows' height
 * (e.g. "h-[4.5rem]"); `cellClassName`/`headClassName` the page's cell padding.
 */
export function TableSkeleton({
  headers,
  rows = 8,
  rowClassName,
  headClassName = "px-4 py-3 font-medium",
  cellClassName = "px-4 py-4",
  maxHeight,
  className,
}: {
  headers: readonly string[];
  rows?: number;
  rowClassName?: string;
  headClassName?: string;
  cellClassName?: string;
  maxHeight?: string;
  className?: string;
}) {
  return (
    <DataTableShell
      maxHeight={maxHeight}
      className={className}
      header={headers.map((header, i) => (
        <th key={i} className={headClassName}>
          {header}
        </th>
      ))}
    >
      {Array.from({ length: rows }).map((_, row) => (
        <tr key={row} className={rowClassName}>
          {headers.map((_, cell) => (
            <td key={cell} className={cn("align-top", cellClassName)}>
              <Skeleton className={cn("h-4", cell === 0 ? "w-4/5" : "w-3/5")} />
            </td>
          ))}
        </tr>
      ))}
    </DataTableShell>
  );
}

/**
 * A plain table inside a card (the inventory / price-list kind: a bordered
 * box, `bg-muted` head, `px-3 py-2` cells) with the page's column names.
 */
export function PlainTableSkeleton({
  headers,
  rows = 8,
  rowClassName,
  className = "max-h-[70vh] overflow-hidden rounded-md border",
}: {
  headers: readonly string[];
  rows?: number;
  rowClassName?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {headers.map((header, i) => (
              <th key={i} className="px-3 py-2 text-right font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {Array.from({ length: rows }).map((_, row) => (
            <tr key={row} className={rowClassName}>
              {headers.map((_, cell) => (
                <td key={cell} className="px-3 py-2">
                  <Skeleton className={cn("h-4", cell === 0 ? "w-4/5" : "w-3/5")} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A labelled field — the label's own words over an Input / NativeSelect's box
 * (h-11, rounded-xl). The label is inline, as the pages write it (`<label>`
 * then the field), so its line is as tall as theirs; `flexLabel` for a label
 * in its own flex row (a search field's, with room for a badge beside it).
 */
export function FieldSkeleton({
  label,
  flexLabel = false,
  className,
}: {
  label?: ReactNode;
  flexLabel?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        flexLabel ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{label}</span>
        )
      ) : null}
      <Skeleton className={cn("block h-11 w-full rounded-xl", label ? "mt-1" : null)} />
    </div>
  );
}

/**
 * A line of text whose words aren't known yet: `className` its text classes
 * (e.g. "text-sm"), so the line is exactly as tall as the real one.
 */
export function TextLineSkeleton({ className, barClassName = "w-32" }: { className?: string; barClassName?: string }) {
  return (
    <div className={className}>
      <Skeleton className={cn("inline-block h-[0.75em] align-middle", barClassName)} />
    </div>
  );
}
