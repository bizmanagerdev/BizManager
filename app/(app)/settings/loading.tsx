import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while settings data (users, Morning integration, VAT/CC
// fee rates, accounts, connected devices) loads, so TTFB = time-to-shell.
// Mirrors the tabs rail + stacked settings cards to keep the swap shift-free.
export default function SettingsLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full max-w-sm" />
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
