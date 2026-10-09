import type { ReactNode } from "react";
import { PageStack } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckboxUncheckedIcon, ChevronDownIcon, DocumentIcon, GaugeIcon, TaskIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpiryRowsSkeleton } from "@/app/(app)/vehicles/VehiclesSkeleton";

// A vehicle's page before its data: the page's own frame (VehicleHeaderCard +
// VehicleActivityClient) — the photo, name and details line (the reminder /
// edit / more buttons beside them from lg; on a phone they're the top bar's
// ⋮), the mileage row, the טסט / ביטוח / רישוי rows (three across from sm),
// then the expenses and tasks cards (side by side from lg) and the documents
// card under them — their names and icons the page's own, blanks where the
// figures will be. The plain loading screen, and the vehicles list's on the
// way in from outside /vehicles (VehiclesLoadingBody).

/** A card's title with its "(N)" still blank. */
function Title({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-1 text-base">
      {icon}
      {children}
      <Skeleton className="h-3.5 w-6" />
    </CardTitle>
  );
}

/** The card header's "+" button (Button size="sm"). */
const ADD_BUTTON = <Skeleton className="h-9 w-[5.5rem] shrink-0 rounded-xl" />;

/** A group's header strip (month / year, its count, and — expenses — its subtotal). */
function GroupHeader({ subtotal = false }: { subtotal?: boolean }) {
  return (
    <div className="flex w-full items-center justify-between gap-2 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <TextLineSkeleton barClassName="w-20" />
        <Skeleton className="h-[1.625rem] w-8 rounded-full" />
      </div>
      <div className="flex items-center gap-2">
        {subtotal ? <Skeleton className="h-4 w-16" /> : null}
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </div>
  );
}

export default function VehiclePageSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  return (
    <PageStack data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Skeleton className="h-16 w-16 shrink-0 rounded-xl sm:h-24 sm:w-24" />
            <div className="min-w-0">
              <TextLineSkeleton className="text-2xl font-semibold" barClassName="w-40" />
              <TextLineSkeleton className="text-sm" barClassName="w-48" />
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-1 lg:flex">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-9 rounded-xl" />
            ))}
          </div>
        </div>

        <div className="flex w-full items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <GaugeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <TextLineSkeleton className="text-xl font-semibold" barClassName="w-24" />
              <TextLineSkeleton className="text-xs" barClassName="w-20" />
            </div>
          </div>
          <Skeleton className="h-4 w-10" />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ExpiryRowsSkeleton />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <Title>הוצאות</Title>
              <TextLineSkeleton className="text-xs" barClassName="w-28" />
            </div>
            {ADD_BUTTON}
          </CardHeader>
          <CardContent className="space-y-2 px-1">
            <div className="border-b">
              <GroupHeader subtotal />
              <div className="px-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b py-2 last:border-0">
                    <div className="min-w-0 text-sm">
                      <TextLineSkeleton className="font-medium" barClassName="w-32" />
                      <TextLineSkeleton className="text-xs" barClassName="w-24" />
                    </div>
                    <Skeleton className="h-4 w-14 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
            <GroupHeader subtotal />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <Title icon={<TaskIcon className="h-4 w-4" />}>משימות</Title>
              <TextLineSkeleton className="text-xs" barClassName="w-16" />
            </div>
            {ADD_BUTTON}
          </CardHeader>
          <CardContent className="space-y-2 px-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border-b last:border-0">
                <div className="flex items-center gap-2 px-3 py-2">
                  <CheckboxUncheckedIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 text-sm">
                    <TextLineSkeleton className="font-medium" barClassName="w-36" />
                    <TextLineSkeleton className="text-xs" barClassName="w-16" />
                  </div>
                  <Skeleton className="h-[1.625rem] w-16 shrink-0 rounded-full" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <Title icon={<DocumentIcon className="h-4 w-4" />}>מסמכים</Title>
            {ADD_BUTTON}
          </CardHeader>
          <CardContent className="space-y-2 px-1">
            <div className="border-b last:border-0">
              <GroupHeader />
              <div className="space-y-2 p-3 pt-2">
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-2 border-b py-2 last:border-0">
                    <Skeleton className="h-10 w-10 shrink-0" />
                    <div className="min-w-0 flex-1 text-sm">
                      <TextLineSkeleton className="font-medium" barClassName="w-28" />
                      <TextLineSkeleton className="text-xs" barClassName="w-16" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageStack>
  );
}
