import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";

export default function ActivityLoading() {
  return (
    <AppShell>
      <div className="space-y-4 text-right" dir="rtl">
        <div>
          <div className="h-6 w-24 animate-pulse rounded-md bg-muted" />
          <div className="mt-1 h-4 w-16 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="h-5 w-12 animate-pulse rounded bg-muted" />
                    <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  </div>
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
