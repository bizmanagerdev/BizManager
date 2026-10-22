import { PageStack } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarIcon, ChecklistIcon } from "@/components/ui/icons";

// The rent page's placeholder, in RentRollClient's own shape ("היום"): the
// underline tabs, the month and the two export buttons, "מה לעשות" (the
// folding section's header and its lines — just the header when folded), the
// four figure cards, the "who owes" chip, and the leases — the table shell on
// a computer, two short lines each on a phone. Shown while the page streams
// (loading.tsx) and while the device works it out (LocalRentRollPage).

const COLUMNS = ["w-28", "w-24", "w-14", "w-28", "w-14", "w-20", "w-16", "w-24"];

export default function RentRollSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <PageStack aria-busy="true">
      <Tabs value="today" dir="rtl" className="-mt-2 md:-mt-4 lg:-mt-6">
        <TabsList variant="underline">
          <TabsTrigger value="today">
            <ChecklistIcon className="h-4 w-4" />
            חודש
          </TabsTrigger>
          <TabsTrigger value="year">
            <CalendarIcon className="h-4 w-4" />
            לוח שנתי
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-[34px] w-[34px] rounded-lg" />
          <TextLineSkeleton className="min-w-[7rem] text-sm font-semibold" barClassName="w-44" />
          <Skeleton className="h-[34px] w-[34px] rounded-lg" />
          <Skeleton className="h-[34px] w-12 rounded-lg" />
        </div>
        <Skeleton className="h-[34px] w-28 rounded-lg" />
        <div className="ms-auto flex items-center gap-1.5">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3">
              <TextLineSkeleton className="text-xs" barClassName="w-16" />
              <TextLineSkeleton className="mt-0.5 text-lg font-semibold" barClassName="w-24" />
              <TextLineSkeleton className="text-xs" barClassName="w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        {/* A computer: the table shell — its header and rows. */}
        <Card className="hidden overflow-hidden border-border/70 shadow-sm lg:block">
          <table className="w-full text-[0.8125rem]">
            <thead className="bg-muted">
              <tr className="border-b border-border/70">
                {COLUMNS.map((width, i) => (
                  <th key={i} className="whitespace-nowrap px-2 py-2 font-medium">
                    <Skeleton className={`inline-block h-[0.75em] align-middle ${width}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, r) => (
                <tr key={r} className="border-b border-border/50">
                  {COLUMNS.map((width, i) => (
                    <td key={i} className="px-2 py-1.5">
                      {i === 3 ? (
                        <Skeleton className="h-[1.625rem] w-20 rounded-full" />
                      ) : (
                        <Skeleton className={`inline-block h-[0.75em] align-middle ${width}`} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* A phone: two short lines a lease. */}
        <Card className="lg:hidden">
          <ul className="divide-y">
            {Array.from({ length: rows }).map((_, i) => (
              <li key={i} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <TextLineSkeleton className="text-sm" barClassName="w-44" />
                  <TextLineSkeleton className="text-sm font-semibold" barClassName="w-14" />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Skeleton className="h-[1.625rem] w-14 rounded-full" />
                  <TextLineSkeleton className="text-xs" barClassName="w-32" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </PageStack>
  );
}
