import AppShell from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the debts load, so the page shell shows at once.
// Mirrors the tab bar, the totals line and two kind sections to keep the swap
// shift-free.
export default function DebtsLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <div className="flex gap-3 border-b border-border/60 pb-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-9 w-full max-w-md" />
        {Array.from({ length: 2 }).map((_, section) => (
          <div key={section} className="space-y-2">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: 4 }).map((__, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-2xl" />
            ))}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
