import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_TABLE_OPTIONS,
  getAuditActorOptions,
  getAuditFeed,
  getUserPresenceRoster,
  resolveActorFilterValues,
} from "@/lib/audit";
import { searchActivity } from "@/lib/activity/search";
import { loadActivityToday } from "@/lib/activity/today";
import { israelDateKey } from "@/lib/timezone";
import ActivitySkeleton, { ActivityStripSkeleton } from "./ActivitySkeleton";

// The same placeholder as loading.tsx while the client's code loads, so the
// page doesn't pass through a second, different one.
const ActivityClient = dynamic(() => import("./ActivityClient"), {
  loading: () => (
    <>
      <ActivityStripSkeleton />
      <ActivitySkeleton />
    </>
  ),
});

export const revalidate = 30;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const params = await searchParams;
  const tableName = typeof params.table === "string" ? params.table : "";
  const action = typeof params.action === "string" ? params.action : "";
  const worker = typeof params.worker === "string" ? params.worker : "";
  const query = typeof params.q === "string" ? params.q.trim() : "";

  const actorFilterValues = worker ? await resolveActorFilterValues(supabase, worker) : [];

  // Roster reads every user's session/last-seen — use the service-role client so
  // RLS (users self/office-only SELECT) doesn't hide colleagues from the bar.
  const rosterClient = createSupabaseAdminClient() ?? supabase;
  const todayKey = israelDateKey();
  const filters = {
    tableName: tableName || null,
    action: action || null,
    changedByValues: actorFilterValues.length ? actorFilterValues : null,
  };

  const [feed, workerOptions, roster, today] = await Promise.all([
    query ? searchActivity(supabase, query, filters) : getAuditFeed(supabase, filters),
    getAuditActorOptions(supabase),
    getUserPresenceRoster(rosterClient),
    loadActivityToday(supabase, todayKey),
  ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <ActivityClient
        feedKey={`${tableName}|${action}|${worker}|${query}`}
        items={feed.items}
        hasMore={feed.hasMore}
        error={feed.error}
        tableOptions={[...AUDIT_TABLE_OPTIONS]}
        actionOptions={[...AUDIT_ACTION_OPTIONS]}
        workerOptions={[{ value: "", label: "כל המשתמשים" }, ...workerOptions]}
        currentTable={tableName}
        currentAction={action}
        currentWorker={worker}
        currentQuery={query}
        actorFilterValues={actorFilterValues}
        roster={roster}
        today={today}
        todayKey={todayKey}
      />
    </AppShell>
  );
}
