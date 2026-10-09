import { AdaptiveGrid, PageStack } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent } from "@/components/ui/card";
import {
  ApprovedDocumentIcon,
  DocumentIcon,
  ExpenseIcon,
  IdCardIcon,
  MoreIcon,
  ShieldIcon,
  TaskIcon,
} from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

// The vehicles list's placeholder, from VehiclesClient's own pieces: the sort
// button, then the vehicle cards (one column, two from md, four from xl) —
// each with its photo, name and details line, the טסט / ביטוח / רישוי rows
// with their names and icons, and the expenses / tasks / documents line.
// Shown while the page streams (loading.tsx).

const EXPIRY_ROWS = [
  { label: "טסט", Icon: ApprovedDocumentIcon },
  { label: "ביטוח", Icon: ShieldIcon },
  { label: "רישוי", Icon: IdCardIcon },
];

/**
 * The three expiry rows (VehicleExpiryRow): the name and its icon, the date
 * and its status badge still blank. Also the vehicle page's (VehiclePageSkeleton).
 */
export function ExpiryRowsSkeleton() {
  return (
    <>
      {EXPIRY_ROWS.map(({ label, Icon }) => (
        <div key={label} className="rounded-xl bg-muted/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>{label}</span>
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-[1.625rem] w-14 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function VehiclesSkeleton() {
  return (
    <PageStack aria-busy="true">
      <div className="flex items-center justify-end">
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
      <AdaptiveGrid variant="customerStats">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
                  <div className="min-w-0">
                    <TextLineSkeleton className="text-lg font-semibold" barClassName="w-28" />
                    <TextLineSkeleton className="text-sm" barClassName="w-40" />
                  </div>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground">
                  <MoreIcon className="h-4 w-4" />
                </div>
              </div>

              <div className="space-y-2">
                <ExpiryRowsSkeleton />
              </div>

              <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                {[ExpenseIcon, TaskIcon, DocumentIcon].map((Icon, j) => (
                  <div key={j} className="flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5" />
                    <TextLineSkeleton barClassName="w-12" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </AdaptiveGrid>
    </PageStack>
  );
}
