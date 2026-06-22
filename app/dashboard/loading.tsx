import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QuickActionsFallback, PanelsFallback } from "@/app/dashboard/DashboardSections";

// Streamed instantly while the page's auth check runs, so the document's first
// byte (TTFB) no longer waits for any data. Renders the real AppShell (nav
// resolves from cached role) and the SAME skeletons the page uses, so there's no
// visual jump as it hands off to the page.
export default function DashboardLoading() {
  return (
    <AppShell>
      <PageStack data-route-loading="true">
        <Skeleton className="h-7 w-56" />
        <Card>
          <CardContent className="pt-6">
            <QuickActionsFallback />
          </CardContent>
        </Card>
        <PanelsFallback />
      </PageStack>
    </AppShell>
  );
}
