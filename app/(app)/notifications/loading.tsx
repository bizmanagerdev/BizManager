import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { PageStack } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the notification history loads, so TTFB =
// time-to-shell. Mirrors the header + notification list to keep the swap
// shift-free.
export default function NotificationsLoading() {
  return (
    <AppShell>
      <PageStack data-route-loading="true">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </Card>
          ))}
        </div>
      </PageStack>
    </AppShell>
  );
}
