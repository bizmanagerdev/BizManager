import AppShell from "@/components/layout/AppShell";
import InboxSkeleton from "@/app/(app)/inbox/InboxSkeleton";

// /alerts only redirects to the inbox (old links, bookmarks, push payloads),
// so while that answer comes back it shows where it is going: the inbox's own
// loading screen, instead of nothing.
export default function AlertsLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <InboxSkeleton />
      </div>
    </AppShell>
  );
}
