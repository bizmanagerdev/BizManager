import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { NotificationIcon } from "@/components/ui/icons";
import NotificationsSkeleton from "./NotificationsSkeleton";

// Streamed instantly while the notification history loads, so TTFB =
// time-to-shell. The page's own heading (its words are known) over the
// history's shape (NotificationsSkeleton) to keep the swap shift-free.
export default function NotificationsLoading() {
  return (
    <AppShell>
      <PageStack data-route-loading="true">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <NotificationIcon className="h-6 w-6" />
            התראות
          </h1>
          <p className="text-sm text-muted-foreground">כל ההתראות שקיבלת — נקראו ושלא נקראו.</p>
        </div>
        <NotificationsSkeleton />
      </PageStack>
    </AppShell>
  );
}
