import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RouteLoading({ title }: { title?: string }) {
  return (
    <AppShell>
      <div className="space-y-4 animate-pulse">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-7 w-48 bg-muted rounded" />
            {title ? (
              <div className="text-sm text-muted-foreground">{title}</div>
            ) : (
              <div className="h-4 w-32 bg-muted rounded" />
            )}
          </div>
          <div className="h-4 w-20 bg-muted rounded" />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  <div className="h-4 w-24 bg-muted rounded" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-4 w-full bg-muted rounded" />
                <div className="h-4 w-5/6 bg-muted rounded" />
                <div className="h-4 w-2/3 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

