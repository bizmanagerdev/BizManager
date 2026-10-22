import { AdaptiveGrid, PageStack } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The properties list's placeholder, in PropertiesClient's own shape: the
// search box, then the property cards (one column, two from md, four from
// xl) — each with its photo, name and address and ⋮, the renter and rent
// rows, and the tasks / documents / money line under them (PropertyListCard).
// Shown while the page streams (loading.tsx) and while the device works the
// list out (LocalPropertiesPage).

export default function PropertiesSkeleton() {
  return (
    <PageStack aria-busy="true">
      {/* The page's search: 24rem from md, as ListSearch. */}
      <Skeleton className="h-10 w-full rounded-xl md:w-96" />

      <AdaptiveGrid variant="entityCards">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex items-start gap-3 ps-3">
                <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <TextLineSkeleton className="text-lg font-semibold" barClassName="w-32" />
                  <TextLineSkeleton className="h-[2lh] text-sm" barClassName="w-40" />
                </div>
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
              </div>

              {/* The one row: who rents it, what they pay, until when. */}
              <div className="space-y-2">
                <Skeleton className="h-14 rounded-xl" />
              </div>

              <div className="mt-auto flex items-center gap-3">
                <TextLineSkeleton className="text-xs" barClassName="w-20" />
                <TextLineSkeleton className="text-xs" barClassName="w-16" />
                <TextLineSkeleton className="text-xs" barClassName="w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </AdaptiveGrid>
    </PageStack>
  );
}
