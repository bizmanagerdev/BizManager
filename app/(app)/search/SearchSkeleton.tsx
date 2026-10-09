"use client";

import { useSearchParams } from "next/navigation";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The search page while the query runs, from its own pieces: the heading,
// then — the query is in the address, so it is known — the "חיפוש: …" card
// and the result groups (two across from xl), each a titled card of result
// rows; with no query, the page's own hint card. For the route's loading
// screen.
export default function SearchSkeleton() {
  const query = (useSearchParams()?.get("q") ?? "").trim();
  return (
    <div className="space-y-4" aria-busy="true">
      <div>
        <h1 className="text-2xl font-semibold">חיפוש גלובלי</h1>
        <p className="text-sm text-muted-foreground">
          מקום אחד לחיפוש לקוחות, פרויקטים, משימות, מכירות, מסמכים, מלאי ופיננסים.
        </p>
      </div>

      {!query ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            הקלידו בשורת החיפוש העליונה כדי לחפש בכל המערכת.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-6 text-sm">
              <div>
                <span className="text-muted-foreground">חיפוש:</span> <span className="font-medium">{query}</span>
              </div>
              <div className="text-muted-foreground">
                <Skeleton className="inline-block h-[0.75em] w-6 align-middle" /> תוצאות
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <TextLineSkeleton className="text-lg leading-none" barClassName="w-24" />
                  <TextLineSkeleton className="text-sm" barClassName="w-16" />
                </CardHeader>
                <CardContent className="space-y-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="rounded-2xl border border-border/70 p-4">
                      <TextLineSkeleton className="font-medium" barClassName="w-1/2" />
                      <TextLineSkeleton className="mt-1 text-sm" barClassName="w-2/3" />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Skeleton className="h-6 w-16 rounded-full" />
                        <Skeleton className="h-6 w-20 rounded-full" />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
