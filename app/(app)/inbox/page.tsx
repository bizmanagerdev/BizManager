import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getInboxView, getCreatedByMeReminders } from "@/lib/reminders/worklist";
import InboxClient from "@/app/(app)/inbox/InboxClient";

export const revalidate = 30;

// "התיבה שלי" — the ONE list of everything still open for this viewer.
// Replaces the old /alerts worklist + /notifications history split: one page,
// filtered by origin (הכל / שלי / אוטומטי) rather than six life-area sections.
export default async function InboxPage() {
  const { profile, supabase, user } = await requireProfile();
  const canSync = profile.role === "admin" || profile.role === "office";

  // When the viewer last opened the inbox — anything newer is "חדש".
  const seenAt = await supabase
    .from("users")
    .select("inbox_seen_at")
    .eq("id", profile.id)
    .maybeSingle()
    .then(
      (r) => {
        const v = (r.data as { inbox_seen_at?: unknown } | null)?.inbox_seen_at;
        return typeof v === "string" ? v : null;
      },
      () => null // column may not exist yet (pre-migration) → treat all as new
    );

  const [inbox, assignedByMe, pushCount] = await Promise.all([
    getInboxView(supabase, { userId: profile.id, role: profile.role, seenAt }),
    getCreatedByMeReminders(supabase, { userId: profile.id }),
    supabase
      .from("push_subscriptions")
      .select("id", { count: "estimated", head: true })
      .eq("user_id", user.id)
      .then((r) => (typeof r.count === "number" ? r.count : 0), () => 0),
  ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <InboxClient
        inbox={inbox}
        assignedByMe={assignedByMe}
        canSync={canSync}
        hasPush={pushCount > 0}
        locale={profile.locale}
      />
    </AppShell>
  );
}
