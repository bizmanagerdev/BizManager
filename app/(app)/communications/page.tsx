import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getRecentCommunications } from "@/lib/communications";
import { PageStack } from "@/components/layout/page-layout";
import { ChatIcon } from "@/components/ui/icons";
import CommunicationsClient from "@/app/(app)/communications/CommunicationsClient";

export const revalidate = 30;

// "תיעוד פניות" — the GLOBAL communications log. Every call/WhatsApp/meeting
// logged from anywhere in the app, tagged by topic, filterable. Replaces the
// collection-only call log; collections now reads its slice via the timeline.
export default async function CommunicationsPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <div className="p-6 text-sm text-muted-foreground">אין הרשאה לצפייה בתיעוד הפניות.</div>
      </AppShell>
    );
  }

  const logs = await getRecentCommunications(supabase, { limit: 300 });

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ChatIcon className="h-6 w-6" />
            תיעוד פניות
          </h1>
          <p className="text-sm text-muted-foreground">כל השיחות, ההודעות והפגישות מכל חלקי המערכת — מסוננות לפי נושא.</p>
        </div>
        <CommunicationsClient logs={logs} />
      </PageStack>
    </AppShell>
  );
}
