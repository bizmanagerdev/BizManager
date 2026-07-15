import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getWorklistView, getWorklistPrefs, getCreatedByMeReminders } from "@/lib/reminders/worklist";
import { getTodayInboxData } from "@/lib/today-inbox";
import TodayInbox from "@/components/TodayInbox";
import WorklistClient from "@/app/(app)/alerts/WorklistClient";

export const revalidate = 30;

// "מה דורש טיפול" — the unified worklist, sectioned by life-area. Discrete actions
// are listed; items that own a workspace (collections, inventory…) collapse to a
// summary line. The dated agenda lives on its own /calendar ("יומן") page.
export default async function AlertsPage() {
  const { profile, supabase, user } = await requireProfile();
  const canSync = profile.role === "admin" || profile.role === "office";

  const worklistPrefs = await getWorklistPrefs(supabase, profile.id);
  const [sections, assignedByMe, todayInbox, pushCount] = await Promise.all([
    getWorklistView(supabase, { userId: profile.id, role: profile.role, prefs: worklistPrefs }),
    getCreatedByMeReminders(supabase, { userId: profile.id }),
    getTodayInboxData(supabase, profile),
    // Does this viewer have any registered device? (subscriptions are keyed by
    // the AUTH user id.) Drives the "will/won't ping your phone" hints.
    supabase
      .from("push_subscriptions")
      .select("id", { count: "estimated", head: true })
      .eq("user_id", user.id)
      .then((r) => (typeof r.count === "number" ? r.count : 0), () => 0),
  ]);
  const hasPush = pushCount > 0;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-5">
        <TodayInbox data={todayInbox} />

        <WorklistClient
          sections={sections}
          assignedByMe={assignedByMe}
          canSync={canSync}
          hasPush={hasPush}
          prefs={worklistPrefs}
        />
      </div>
    </AppShell>
  );
}
