import { AdaptiveCell, AdaptiveGrid, PageStack } from "@/components/layout/page-layout";
import { FieldSkeleton, TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { PageHeaderToolbarSkeleton } from "@/components/layout/PageHeaderToolbarSkeleton";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { Skeleton } from "@/components/ui/skeleton";

// The customers list's placeholder, from CustomersClient's own pieces: the lg+
// toolbar (search, filters, export) and the count line, then the fixed-column
// table from xl and the swipe cards below it, and the "showing N of M" line.
// On a phone the search / filter / export row lives in the header strip
// (CustomersStripSkeleton). Shown while the page streams (loading.tsx) and
// while the list's code loads (the dynamic() fallback).

const COLUMNS: { label: string; width: string }[] = [
  { label: "לקוח", width: "w-[17%]" },
  { label: "טלפון ואימייל", width: "w-[15%]" },
  { label: "כתובת", width: "w-[14%]" },
  { label: "Morning", width: "w-[6%]" },
  { label: "הזמנות", width: "w-[6%]" },
  { label: "פרויקטים", width: "w-[6%]" },
  { label: "יתרה פתוחה", width: "w-[9%]" },
  { label: "סטטוס", width: "w-[11%]" },
  { label: "פעולות", width: "w-[16%]" },
];

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

export default function CustomersSkeleton() {
  return (
    <PageStack aria-busy="true">
      <AdaptiveGrid variant="customersToolbar" className="hidden lg:grid">
        <FieldSkeleton label="חיפוש לקוחות" flexLabel className="lg:col-span-4" />
        {/* The two buttons sit under an invisible label, as on the page. */}
        {["מסננים", "יצוא"].map((label) => (
          <AdaptiveCell key={label} variant="customersSecondary">
            <span className="text-sm opacity-0">{label}</span>
            <Skeleton className="h-11 w-full rounded-xl" />
          </AdaptiveCell>
        ))}
      </AdaptiveGrid>

      <TextLineSkeleton className="hidden text-sm lg:block" barClassName="w-28" />

      <ResponsiveDataView
        breakpoint="xl"
        mobile={
          <div className="grid grid-cols-1 gap-2">
            <p className="px-1 text-[11px] text-muted-foreground">החלק כרטיס ימינה לפעולות · הקש לפרטים</p>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="relative min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                <div className="flex w-full min-w-0 items-center gap-3 p-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <TextLineSkeleton className="text-sm font-semibold leading-snug" barClassName="w-36" />
                    <TextLineSkeleton className="text-xs" barClassName="w-24" />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Skeleton className="h-4 w-14 rounded-full" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                    </div>
                  </div>
                  <ChevronLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        }
        desktop={
          <DataTableShell
            tableClassName="table-fixed"
            colgroup={COLUMNS.map((column) => (
              <col key={column.label} className={column.width} />
            ))}
            header={COLUMNS.map((column) => (
              <th key={column.label} className="px-2 py-2 font-medium">
                {column.label}
              </th>
            ))}
          >
            {/* A row: the name, phone over email, an address that often wraps. */}
            {Array.from({ length: 10 }).map((_, row) => (
              <tr key={row} className="h-[3.25rem] align-middle">
                {COLUMNS.map((column, cell) => (
                  <td key={column.label} className="px-2 py-1.5">
                    <Skeleton className={cell === 0 ? "h-4 w-4/5" : "h-4 w-3/5"} />
                  </td>
                ))}
              </tr>
            ))}
          </DataTableShell>
        }
      />

      <TextLineSkeleton className="pt-1 text-center text-xs" barClassName="w-32" />
    </PageStack>
  );
}
