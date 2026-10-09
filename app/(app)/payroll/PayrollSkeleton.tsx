import { UnderlineTabsSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarCheckIcon, LaborIcon, ReceiptIcon, UsersIcon, WalletIcon } from "@/components/ui/icons";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { Skeleton } from "@/components/ui/skeleton";
import { MiniStat } from "./SalaryCenterUi";

// The salary center before its data, from SalaryCenterClient's own classes:
// the month / search / "add user" row, the five-figure summary card, the
// underline tabs (עובדים open — the client always opens there) and the
// employees card — the table from lg, the worker cards below it. Drawn for an
// admin (the five tabs, the add button); office sees three tabs and no button.
// Shown while the page streams (loading.tsx, via PayrollLoadingBody) and while
// the client's code loads (page.tsx's dynamic() fallback).

// A StatusPill / badge: text-xs, py-1, a border.
const PILL = "h-[calc(1.5rem+2px)] rounded-full";

// A MiniStat's value line, blank (its own line height holds it).
const VALUE = <Skeleton className="inline-block h-4 w-20 align-middle" />;

const COLUMNS = [
  "עובד",
  "סטטוס",
  "סוג עובד",
  "שעות החודש",
  "משכורת נוכחית",
  "עלות עבודה החודש",
  "תלוש אחרון",
  "סטטוס תשלום",
  "שולם כולל",
  "יתרה כוללת",
  "פעולות",
];

// A text-xs cell's one line.
function CellLine({ className = "w-12" }: { className?: string }) {
  return (
    <div className="flex h-4 items-center justify-center">
      <Skeleton className={`h-3 ${className}`} />
    </div>
  );
}

function EmployeesTableSkeleton() {
  return (
    <div className="max-h-[70vh] overflow-hidden">
      <table className="w-full text-center text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr className="border-b text-muted-foreground">
            {COLUMNS.map((column) => (
              <th key={column} className="px-2 py-2 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }).map((_, row) => (
            <tr key={row} className={`border-b align-top ${row % 2 === 0 ? "bg-muted/20" : "bg-background"}`}>
              <td className="w-[180px] px-2 py-2">
                <div className="flex flex-col items-center gap-1">
                  <CellLine className="w-20" />
                  <div className="flex flex-col items-center">
                    <CellLine className="w-28" />
                    <CellLine className="w-20" />
                  </div>
                </div>
              </td>
              {/* Role, access and active — three pills, the row's tallest cell. */}
              <td className="px-2 py-2">
                <div className="flex flex-col items-center gap-1">
                  <Skeleton className={`${PILL} w-12`} />
                  <Skeleton className={`${PILL} w-14`} />
                  <Skeleton className={`${PILL} w-10`} />
                </div>
              </td>
              <td className="px-2 py-2">
                <Skeleton className={`${PILL} mx-auto w-16`} />
              </td>
              {[0, 1, 2, 3].map((cell) => (
                <td key={cell} className="px-2 py-2">
                  <CellLine />
                </td>
              ))}
              <td className="px-2 py-2">
                <Skeleton className={`${PILL} mx-auto w-14`} />
              </td>
              {[0, 1].map((cell) => (
                <td key={cell} className="px-3 py-3">
                  <CellLine />
                </td>
              ))}
              <td className="px-3 py-3">
                <Skeleton className="mx-auto h-9 w-16 rounded-xl" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A worker's card below lg: name / phone / email and the active pill, the type
// and role pills, two figures, the payment badge and "פרטים".
function EmployeeCardSkeleton() {
  return (
    <div className="rounded-2xl border bg-background p-4 text-right shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex h-6 items-center">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton className="h-2.5 w-36" />
          </div>
        </div>
        <Skeleton className={`${PILL} w-12 shrink-0`} />
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Skeleton className={`${PILL} w-16`} />
        <Skeleton className={`${PILL} w-12`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <MiniStat label="יתרה כוללת" value={VALUE} />
        {/* משמרות / שעות החודש — which one depends on the worker's type. */}
        <div className="rounded-xl border bg-muted/10 p-2.5 text-center">
          <div className="flex h-4 items-center justify-center">
            <Skeleton className="h-2.5 w-16" />
          </div>
          <div className="mt-0.5 font-semibold">{VALUE}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Skeleton className={`${PILL} w-16`} />
        <Skeleton className="h-9 w-16 rounded-xl" />
      </div>
    </div>
  );
}

export default function PayrollSkeleton() {
  return (
    <div className="space-y-4 text-right" dir="rtl" aria-busy="true">
      {/* Month picker, worker search, "הוספת משתמש". */}
      <div className="flex flex-col items-center gap-2 py-1 sm:flex-row sm:justify-between">
        <div className="flex h-11 shrink-0 items-center">
          <Skeleton className="h-5 w-28" />
        </div>
        <Skeleton className="h-11 w-full max-w-sm rounded-xl sm:mx-2" />
        <div className="flex shrink-0 flex-wrap justify-center gap-2 sm:flex-nowrap">
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3 lg:grid-cols-5">
          <MiniStat label="עלות עבודה החודש" value={VALUE} strong />
          <MiniStat label="יתרה לעובדים" value={VALUE} strong />
          <MiniStat label="קבלנות" value={VALUE} />
          <MiniStat label="שעתי עם תלוש" value={VALUE} />
          <MiniStat label="חודשי גלובלי" value={VALUE} />
        </CardContent>
      </Card>

      <div>
        <UnderlineTabsSkeleton
          className="sm:justify-center"
          labels={[
            <><UsersIcon className="h-4 w-4" />עובדים</>,
            <><LaborIcon className="h-4 w-4" />פועלים</>,
            <><CalendarCheckIcon className="h-4 w-4" />נוכחות</>,
            <><WalletIcon className="h-4 w-4" />משכורות</>,
            <><ReceiptIcon className="h-4 w-4" />תקופות ותלושים</>,
          ]}
        />
        <div className="mt-4 space-y-3">
          <Card>
            <CardContent className="py-4">
              <ResponsiveDataView
                breakpoint="lg"
                desktop={<EmployeesTableSkeleton />}
                mobile={
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <EmployeeCardSkeleton key={i} />
                    ))}
                  </div>
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
