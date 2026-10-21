import { PageStack } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The rent roll's placeholder, in RentRollClient's own shape: the one row on
// top (the month, its money, the "who still owes" chip), then the leases — a
// table on a computer, two short lines each on a phone. Shown while the page
// streams (loading.tsx) and while the device works the roll out
// (LocalRentRollPage).

const COLUMNS = ["w-24", "w-24", "w-12", "w-14", "w-14", "w-16", "w-16", "w-20", "w-20", "w-12", "w-16", "w-20", "w-20", "w-16", "w-16"];

export default function RentRollSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <PageStack aria-busy="true">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Skeleton className="h-9 w-24 rounded-lg" />
        <Skeleton className="h-9 w-60 rounded-lg" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <TextLineSkeleton key={i} className="text-sm" barClassName="w-24" />
          ))}
        </div>
        <Skeleton className="h-[34px] w-32 rounded-lg" />
        <div className="ms-auto flex items-center gap-1.5">
          <Skeleton className="h-8 w-16 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>

      <div>
        {/* A computer: the table — its header and rows. */}
        <Card className="hidden overflow-hidden lg:block">
          <table className="w-full text-[0.8125rem]">
            <thead className="border-b bg-muted/40 text-xs">
              <tr>
                {COLUMNS.map((width, i) => (
                  <th key={i} className="px-1.5 py-2 text-start font-medium">
                    <Skeleton className={`inline-block h-[0.75em] align-middle ${width}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {Array.from({ length: rows }).map((_, r) => (
                <tr key={r}>
                  {COLUMNS.map((width, i) => (
                    <td key={i} className="px-1.5 py-1.5">
                      {i === 4 ? (
                        <Skeleton className="h-[1.375rem] w-14 rounded-full" />
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
                  <Skeleton className="h-[1.375rem] w-24 rounded-full" />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <TextLineSkeleton className="text-xs" barClassName="w-40" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </PageStack>
  );
}
