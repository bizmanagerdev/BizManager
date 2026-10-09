import type { ReactNode } from "react";
import { PageStack } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BuildingIcon, ChevronDownIcon, DocumentIcon, TaskIcon, TrendDownIcon, TrendUpIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

// A property's page before its data: the page's own frame (properties/[id]/
// page.tsx + PropertyDetailClient) — the name and address, the four figure
// cards (two across on a phone, four from sm) with their names, then the
// details card, the lease card, and the activity cards (two columns from lg):
// expenses, other income, rent payments, tasks, recurring charges, purchase,
// furniture, contract numbers, photos and — full width — documents. Their
// titles and buttons are the page's own; blanks where the figures will be.
// The plain loading screen, the properties list's on the way in from outside
// /properties (PropertiesLoadingBody), and — its body only — the fallback
// while PropertyDetailClient's code loads.

/** A card's title, with its "(N)" still blank when the page shows a count there. */
function Title({ icon, count = true, children }: { icon?: ReactNode; count?: boolean; children: ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-1 text-base">
      {icon}
      {children}
      {count ? <Skeleton className="h-3.5 w-6" /> : null}
    </CardTitle>
  );
}

/** A card with the page's header line (title, its buttons) over its body. */
function SectionSkeleton({
  title,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  actions: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        {title}
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

const ICON_BUTTON = <Skeleton className="h-9 w-9 rounded-xl" />;

/** A header button with words (Button size="sm"), `width` its own. */
function button(width: string) {
  return <Skeleton className={`h-9 rounded-xl ${width}`} />;
}

/** A list row: its name and date lines, the amount and the row's buttons. */
function Rows({ count, buttons = 2 }: { count: number; buttons?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
          <div className="min-w-0 text-sm">
            <TextLineSkeleton className="font-medium" barClassName="w-32" />
            <TextLineSkeleton className="text-xs" barClassName="w-20" />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Skeleton className="h-4 w-14" />
            {Array.from({ length: buttons }).map((_, j) => (
              <Skeleton key={j} className="h-9 w-9 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Everything under the figure cards (PropertyDetailClient's own layout). */
export function PropertyDetailBodySkeleton() {
  return (
    <>
      <SectionSkeleton title={<Title count={false}>פרטי הנכס</Title>} actions={ICON_BUTTON}>
        <TextLineSkeleton className="text-sm" barClassName="w-56 max-w-full" />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Skeleton className="h-[1.625rem] w-14 rounded-full" />
          <Skeleton className="h-[1.625rem] w-20 rounded-full" />
        </div>
      </SectionSkeleton>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">שכירות</CardTitle>
          {button("w-[6.5rem]")}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-[1.625rem] w-12 rounded-full" />
              </div>
              <TextLineSkeleton className="text-xs" barClassName="w-36" />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Skeleton className="h-4 w-16" />
              {ICON_BUTTON}
              {ICON_BUTTON}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden>
        <SectionSkeleton title={<Title>הוצאות</Title>} actions={button("w-[5.5rem]")}>
          <div className="space-y-2 pe-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className={i < 2 ? "border-b pb-2" : "pb-2"}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <ChevronDownIcon className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground" />
                    <div className="min-w-0 flex-1 text-sm">
                      <TextLineSkeleton className="font-medium" barClassName="w-32" />
                      <TextLineSkeleton className="text-xs" barClassName="w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-14 shrink-0" />
                </div>
              </div>
            ))}
          </div>
        </SectionSkeleton>

        <SectionSkeleton title={<Title>הכנסות אחרות</Title>} actions={button("w-[5.5rem]")}>
          <Rows count={1} buttons={1} />
        </SectionSkeleton>

        <SectionSkeleton title={<Title>תשלומי שכירות</Title>} actions={button("w-44")}>
          <Rows count={2} />
        </SectionSkeleton>

        <SectionSkeleton title={<Title icon={<TaskIcon className="h-4 w-4" />}>משימות</Title>} actions={button("w-[5.5rem]")}>
          <Rows count={1} />
        </SectionSkeleton>

        <SectionSkeleton title={<Title>הוצאות קבועות</Title>} actions={button("w-32")}>
          <Rows count={2} />
        </SectionSkeleton>

        <SectionSkeleton title={<Title count={false}>רכישת הנכס</Title>} actions={<>{button("w-[5rem]")}{ICON_BUTTON}</>}>
          <TextLineSkeleton className="text-sm" barClassName="w-40" />
        </SectionSkeleton>

        <SectionSkeleton title={<Title count={false}>ריהוט</Title>} actions={ICON_BUTTON}>
          <TextLineSkeleton className="text-sm" barClassName="w-32" />
        </SectionSkeleton>

        <SectionSkeleton title={<Title count={false}>מספרי חוזה</Title>} actions={ICON_BUTTON}>
          <TextLineSkeleton className="text-sm" barClassName="w-48" />
        </SectionSkeleton>

        <SectionSkeleton title={<Title>תמונות הנכס</Title>} actions={button("w-32")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        </SectionSkeleton>

        <SectionSkeleton
          className="lg:col-span-2"
          title={<Title icon={<DocumentIcon className="h-4 w-4" />}>מסמכים</Title>}
          actions={button("w-[5rem]")}
        >
          <Rows count={2} buttons={1} />
        </SectionSkeleton>
      </div>
    </>
  );
}

const FIGURES: { label: string; icon?: ReactNode }[] = [
  { label: "הוצאות ששולמו", icon: <TrendDownIcon className="h-3.5 w-3.5" /> },
  { label: "הוצאות צפויות", icon: <TrendDownIcon className="h-3.5 w-3.5" /> },
  { label: "הכנסות שנגבו (שכירות וכו')", icon: <TrendUpIcon className="h-3.5 w-3.5" /> },
  { label: "נטו" },
];

export default function PropertyPageSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  return (
    <PageStack data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div>
        <div className="flex items-center gap-2 text-2xl font-semibold">
          <BuildingIcon className="h-6 w-6" />
          <TextLineSkeleton barClassName="w-48" />
        </div>
        <TextLineSkeleton className="text-sm" barClassName="w-40" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FIGURES.map(({ label, icon }) => (
          <Card key={label} className="min-w-0">
            <CardContent className="p-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {icon}
                {label}
              </div>
              <TextLineSkeleton className="mt-1 text-lg font-semibold" barClassName="w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <PropertyDetailBodySkeleton />
    </PageStack>
  );
}
