import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the page's data loads, so TTFB = time-to-shell.
// Mirrors the projects tabs + toolbar + list to keep the swap shift-free.
export default function ProjectsLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-28" />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-full max-w-xs" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
