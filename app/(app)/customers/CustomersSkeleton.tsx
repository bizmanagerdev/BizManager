"use client";

import { useSearchParams } from "next/navigation";
import { PageStack } from "@/components/layout/page-layout";
import { FieldSkeleton, TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { PageHeaderToolbarSkeleton } from "@/components/layout/PageHeaderToolbarSkeleton";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { LIST_CARD_BODY, LIST_CARD_META, LIST_CARD_NAME } from "@/components/ui/list-card";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { customersFilterSummary, parseCustomersFilters } from "@/app/(app)/customers/customersFilters";
import {
  CUSTOMERS_CELL,
  CUSTOMERS_COLUMNS,
  CUSTOMERS_COUNT_ROW,
  CUSTOMERS_HEAD_CELL,
  CUSTOMERS_HINT_ROW,
  CUSTOMERS_HINT_TEXT,
  CUSTOMERS_SWIPE_HINT,
  CUSTOMERS_TABLE_CLASS,
  CUSTOMERS_TOOLBAR,
} from "@/app/(app)/customers/customersTable";
import { CustomersFilterSummaryLine } from "@/app/(app)/customers/CustomersFilterSummary";

// The customers list's placeholder, from CustomersClient's own pieces: the md+
// toolbar (search, filter toggle, export), the filter summary when the address
// has filters, the count line, then the table from lg (1024px) and the swipe
// cards below it, and the "showing N of M" line. On a phone the search /
// filter / export row lives in the header strip (CustomersStripSkeleton).
// Shown while the page streams (loading.tsx) and while the list's code loads
// (the dynamic() fallback).

/** The phone strip's search, filter and export buttons, as the list puts them there. */
export function CustomersStripSkeleton() {
  return (
    <PageHeaderToolbarSkeleton>
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
      <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
    </PageHeaderToolbarSkeleton>
  );
}

/** A pill's height: its 0.647rem line, py-0.5 and the border (LIST_CARD_BADGE). */
const PILL = "h-[calc(0.647rem*1.5+0.25rem+2px)] rounded-full";

export default function CustomersSkeleton() {
  const searchParams = useSearchParams();
  const summary = customersFilterSummary(parseCustomersFilters((param) => searchParams?.get(param)));

  return (
    <PageStack aria-busy="true">
      <div className={CUSTOMERS_TOOLBAR}>
        <FieldSkeleton label="חיפוש לקוחות" />
        <Skeleton className="h-11 w-24 rounded-xl" />
        <Skeleton className="h-11 w-32 rounded-xl" />
      </div>

      {summary ? <CustomersFilterSummaryLine summary={summary} /> : null}

      <div className={CUSTOMERS_COUNT_ROW}>
        <TextLineSkeleton barClassName="w-28" />
      </div>

      <div>
        <ResponsiveDataView
          breakpoint="lg"
          mobile={
            <div className="grid grid-cols-1 gap-2">
              <div className={CUSTOMERS_HINT_ROW}>
                <p className={CUSTOMERS_HINT_TEXT}>{CUSTOMERS_SWIPE_HINT}</p>
              </div>
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="relative min-w-0 overflow-hidden rounded-card border border-border/70 bg-card shadow-card">
                  {/* The card's own lines: the name, the phone with the call
                      button in the corner, then the pills. */}
                  <div className={LIST_CARD_BODY}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <TextLineSkeleton className={LIST_CARD_NAME} barClassName="w-36" />
                        <TextLineSkeleton className={cn("mt-0.5", LIST_CARD_META)} barClassName="w-24" />
                      </div>
                      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <Skeleton className={cn(PILL, "w-16")} />
                      <Skeleton className={cn(PILL, "w-20")} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          }
          desktop={
            <DataTableShell
              tableClassName={CUSTOMERS_TABLE_CLASS}
              colgroup={CUSTOMERS_COLUMNS.map((column) => (
                <col key={column.key} className={column.width} />
              ))}
              header={CUSTOMERS_COLUMNS.map((column) => (
                <th key={column.key} className={CUSTOMERS_HEAD_CELL}>
                  {column.srOnly ? <span className="sr-only">{column.label}</span> : column.label}
                </th>
              ))}
            >
              {/* A row: the name, phone over email, an address that often wraps. */}
              {Array.from({ length: 10 }).map((_, row) => (
                <tr key={row} className="h-[3.25rem] align-middle">
                  {CUSTOMERS_COLUMNS.map((column, cell) => (
                    <td key={column.key} className={CUSTOMERS_CELL}>
                      {column.key === "actions" ? (
                        <Skeleton className="h-8 w-8 rounded-xl" />
                      ) : (
                        <Skeleton className={cell === 0 ? "h-4 w-4/5" : "h-4 w-3/5"} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </DataTableShell>
          }
        />
      </div>

      <TextLineSkeleton className="pt-1 text-center text-xs" barClassName="w-32" />
    </PageStack>
  );
}
