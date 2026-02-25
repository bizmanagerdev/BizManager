import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoadingProject() {
  return (
    <AppShell>
      <div className="space-y-4 animate-pulse">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-7 w-56 bg-muted rounded" />
            <div className="h-4 w-40 bg-muted rounded" />
          </div>
          <div className="h-4 w-24 bg-muted rounded" />
        </div>

        <div className="h-6 w-24 bg-muted rounded" />

        <div className="space-y-3">
          <div
            role="tablist"
            aria-label="Project tabs"
            className="inline-flex h-11 items-center justify-start rounded-md bg-muted/60 p-1 text-muted-foreground overflow-x-auto w-full"
          >
            {["סקירה", "פיננסי", "משימות", "מסמכים", "תשלומים"].map((label) => (
              <div
                key={label}
                role="tab"
                aria-selected={false}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-2 text-sm font-medium opacity-60"
              >
                {label}
              </div>
            ))}
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
      </div>
    </AppShell>
  );
}
