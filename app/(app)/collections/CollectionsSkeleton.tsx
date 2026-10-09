import { TextLineSkeleton, UnderlineTabsSkeleton } from "@/components/layout/loading-skeletons";
import { CoinsIcon, UsersIcon } from "@/components/ui/icons";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The collections page before its data, from DebtorsTable's own pieces: the
// underline tabs (לקוחות open, תקבולים צפויים) with their counts, the totals
// line, the toolbar (search and dropdowns from sm, search and filter button
// on a phone), then the aging table from sm and the customer cards below it.
// For the route's loading screen.

const COLUMNS: { label: string; center?: boolean }[] = [
  { label: "לקוח" },
  { label: "טלפון" },
  { label: "סטטוס" },
  { label: "יצירת קשר" },
  { label: "תזכורת" },
  { label: "סה״כ חוב", center: true },
  { label: "פעולות", center: true },
];

// An amount inside the totals line, not known yet.
const AMOUNT = <Skeleton className="inline-block h-[0.75em] w-16 align-middle" />;

// A status badge (Badge: rounded-full px-2.5 py-1 text-xs).
const BADGE = <Skeleton className="h-[1.625rem] w-16 rounded-full" />;

export default function CollectionsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="space-y-3">
        <UnderlineTabsSkeleton
          labels={[
            <>
              <UsersIcon className="h-4 w-4" />
              לקוחות
            </>,
            <>
              <CoinsIcon className="h-4 w-4" />
              תקבולים צפויים
            </>,
          ]}
          counts={[true, true]}
        />

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">סה״כ לגבייה</span>
          <span className="font-semibold">{AMOUNT}</span>
          <span className="text-border">·</span>
          <span className="text-muted-foreground">באיחור</span>
          <span className="font-semibold">{AMOUNT}</span>
        </div>

        {/* sm+: search, show, sort, domain. */}
        <div className="hidden items-center gap-2 sm:flex sm:flex-wrap">
          <Skeleton className="h-9 w-56 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>

        {/* Phone: search and the filter button. */}
        <div className="relative sm:hidden">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 flex-1 rounded-xl" />
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          </div>
        </div>

        <ResponsiveDataView
          breakpoint="sm"
          desktop={
            <div className="max-h-[70vh] overflow-hidden rounded-2xl border border-border/70">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead className="bg-muted">
                  <tr className="border-b border-border/70 text-xs text-muted-foreground">
                    {COLUMNS.map(({ label, center }, i) => (
                      <th key={label} className={cn("py-2 font-medium", i === COLUMNS.length - 1 ? "px-2" : "px-3", center ? "text-center" : "text-right")}>
                        {i === 0 ? (
                          <span className="flex items-center gap-2">
                            <span className="h-4 w-4 rounded-sm border border-input" />
                            {label}
                          </span>
                        ) : (
                          label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="h-[3.25rem] border-b border-border/50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="h-4 w-4 shrink-0 rounded-sm border border-input" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Skeleton className="h-3.5 w-24" />
                      </td>
                      <td className="px-3 py-2">{BADGE}</td>
                      <td className="px-3 py-2">
                        <Skeleton className="h-3 w-16" />
                      </td>
                      <td className="px-3 py-2">
                        <Skeleton className="h-3 w-16" />
                      </td>
                      <td className="px-3 py-2">
                        <Skeleton className="mx-auto h-4 w-16" />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <Skeleton className="h-8 w-8" />
                          <Skeleton className="h-8 w-16" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobile={
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-border/70 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-4 w-4 shrink-0 rounded-sm border border-input" />
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="min-w-0">
                        <TextLineSkeleton className="font-semibold" barClassName="w-36" />
                        <TextLineSkeleton className="mt-1 text-sm" barClassName="w-28" />
                        <TextLineSkeleton className="mt-0.5 text-xs" barClassName="w-24" />
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <TextLineSkeleton className="text-lg font-semibold" barClassName="w-16" />
                        {BADGE}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="rounded-2xl border border-border/70 bg-muted/30 p-3 text-sm font-semibold">
                <TextLineSkeleton barClassName="w-40" />
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
