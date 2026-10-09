import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { ChatIcon } from "@/components/ui/icons";
import CommunicationsSkeleton from "./CommunicationsSkeleton";

// Streamed instantly while the communications log loads, so TTFB =
// time-to-shell. The page's own heading (its words are known) over the log's
// shape (CommunicationsSkeleton) — toolbar, column names, rows — to keep the
// swap shift-free.
export default function CommunicationsLoading() {
  return (
    <AppShell>
      <PageStack data-route-loading="true">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ChatIcon className="h-6 w-6" />
            תיעוד פניות
          </h1>
          <p className="text-sm text-muted-foreground">כל השיחות, ההודעות והפגישות מכל חלקי המערכת — מסוננות לפי נושא.</p>
        </div>
        <CommunicationsSkeleton />
      </PageStack>
    </AppShell>
  );
}
