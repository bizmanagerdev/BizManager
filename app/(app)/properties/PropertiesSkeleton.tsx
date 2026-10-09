import { AdaptiveGrid, PageStack } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent } from "@/components/ui/card";
import { BuildingIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

// The properties list's placeholder, from PropertiesClient's own pieces: the
// heading with its subtitle and the add button (under them on a phone), then
// the property cards (one column, two from md, four from xl) — each with its
// name, address and facts line and its three buttons, the tenant / amenity
// badges, and the expenses / income / net figures under their names. Shown
// while the page streams (loading.tsx).

export default function PropertiesSkeleton() {
  return (
    <PageStack aria-busy="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BuildingIcon className="h-6 w-6" />
            ניהול נכסים
          </h1>
          <p className="text-sm text-muted-foreground">נכסים להשכרה, חוזי שכירות, והוצאות/הכנסות לכל נכס במקום אחד.</p>
        </div>
        <Skeleton className="h-11 rounded-xl sm:w-[7.5rem]" />
      </div>

      <AdaptiveGrid variant="customerStats">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <TextLineSkeleton className="text-lg font-semibold" barClassName="w-40" />
                  <TextLineSkeleton className="text-sm" barClassName="w-32" />
                  <TextLineSkeleton className="text-xs" barClassName="w-44" />
                </div>
                <div className="flex shrink-0 gap-1">
                  {[0, 1, 2].map((j) => (
                    <Skeleton key={j} className="h-9 w-9 rounded-xl" />
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-[1.625rem] w-28 rounded-full" />
                <Skeleton className="h-[1.625rem] w-14 rounded-full" />
              </div>

              <div className="mt-auto grid grid-cols-3 gap-2 text-center text-sm">
                {["הוצאות", "הכנסות", "נטו"].map((label) => (
                  <div key={label} className="min-w-0">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <TextLineSkeleton className="text-xs" barClassName="w-14" />
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
