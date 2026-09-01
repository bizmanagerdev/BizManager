import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DataTableShellProps = {
  /** The `<thead>` row's cells — plain `<th>` elements, columns stay page-defined. */
  header: React.ReactNode;
  /** The `<tbody>` rows. */
  children: React.ReactNode;
  /** `<col>` elements for a fixed-width table — rendered as `<colgroup>`, right after `<table>`. */
  colgroup?: React.ReactNode;
  /** A `<tfoot>` row — e.g. a totals row. */
  tfoot?: React.ReactNode;
  /** Extra content inside the scroll box, after `</table>` — e.g. an infinite-scroll sentinel. */
  footer?: React.ReactNode;
  maxHeight?: string;
  className?: string;
  tableClassName?: string;
  /** Overrides the default `"divide-y divide-border/70"` — set to `""` when rows carry their own border. */
  tbodyClassName?: string;
  /** Extra classes merged onto the header `<tr>`, alongside the default `"border-b border-border/70 text-right"`. */
  headerRowClassName?: string;
};

/**
 * The desktop list chrome repeated across every table page: a Card, a
 * max-height scroll box, and a sticky `<thead>`. Column definitions and row
 * markup vary too much per page to generalize (conditional columns, per-row
 * actions), so this only owns the wrapper — pass `header`/`children` as JSX,
 * same as writing the `<table>` by hand. `scrollRef` forwards to the scroll
 * box, for wiring an infinite-scroll observer against it.
 */
export const DataTableShell = React.forwardRef<HTMLDivElement, DataTableShellProps>(
  function DataTableShell(
    {
      header,
      children,
      colgroup,
      tfoot,
      footer,
      maxHeight = "70vh",
      className,
      tableClassName,
      tbodyClassName = "divide-y divide-border/70",
      headerRowClassName,
    },
    scrollRef
  ) {
    return (
      <Card className={cn("overflow-hidden border-border/70 shadow-sm", className)}>
        <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
          <table className={cn("w-full text-sm", tableClassName)}>
            {colgroup ? <colgroup>{colgroup}</colgroup> : null}
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr className={cn("border-b border-border/70 text-right", headerRowClassName)}>{header}</tr>
            </thead>
            <tbody className={tbodyClassName}>{children}</tbody>
            {tfoot ? <tfoot>{tfoot}</tfoot> : null}
          </table>
          {footer}
        </div>
      </Card>
    );
  }
);
