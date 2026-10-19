"use client";

import { useSearchParams } from "next/navigation";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

// The search page while the query runs, from its own pieces: the heading and
// hint, the search box already holding the query (it is in the address), the
// "N תוצאות" line, then the result groups (two across from xl), each a card
// of result rows. With no query, just the heading and the box. For the
// route's loading screen.
export default function SearchSkeleton() {
  const searchParams = useSearchParams();
  const query = (searchParams?.get("q") ?? "").trim();
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">חיפוש בכל המערכת</h1>
        <p className="text-sm text-muted-foreground">
          שם, מילה מהערה או מתגובה, סכום (1000), תאריך (15/10), טלפון, סניף, מסמך, רכב — וכמה מילים יחד מצמצמות.
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input readOnly value={query} placeholder="מה לחפש?" className="h-11 ps-9 text-base" />
        </div>
        <Button type="button" disabled className="h-11 rounded-xl px-5">
          חיפוש
        </Button>
      </div>

      {query ? (
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <Skeleton className="inline-block h-[0.75em] w-6 align-middle" /> תוצאות
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-3xl border border-border/60 bg-card p-4 shadow-sm">
                <TextLineSkeleton className="pb-1 text-lg" barClassName="w-28" />
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="rounded-2xl border border-border/70 p-4">
                    <TextLineSkeleton className="text-base font-medium" barClassName="w-1/2" />
                    <TextLineSkeleton className="mt-1 text-sm" barClassName="w-2/3" />
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
