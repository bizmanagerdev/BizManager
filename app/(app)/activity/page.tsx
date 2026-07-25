import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_TABLE_OPTIONS,
  getAuditActorOptions,
  getAuditFeedPaginated,
  getUserPresenceRoster,
  resolveActorFilterValues,
} from "@/lib/audit";
import ActivityClient from "./ActivityClient";

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
  const page = Math.max(1, Number(params.page) || 1);
  const tableName = typeof params.table === "string" ? params.table : "";
  const action = typeof params.action === "string" ? params.action : "";
  const worker = typeof params.worker === "string" ? params.worker : "";

  const actorFilterValues = worker ? await resolveActorFilterValues(supabase, worker) : [];

  const [result, workerOptions, roster] = await Promise.all([
    getAuditFeedPaginated(supabase, {
      page,
      tableName: tableName || null,
      action: action || null,
      changedByValues: actorFilterValues.length ? actorFilterValues : null,
    }),
    getAuditActorOptions(supabase),
    getUserPresenceRoster(supabase),
  ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <ActivityClient
        key={`${tableName}|${action}|${worker}|${result.page}`}
        items={result.items}
        totalCount={result.totalCount}
        page={result.page}
        totalPages={result.totalPages}
        error={result.error}
        tableOptions={[...AUDIT_TABLE_OPTIONS]}
        actionOptions={[...AUDIT_ACTION_OPTIONS]}
        workerOptions={[{ value: "", label: "כל המשתמשים" }, ...workerOptions]}
        currentTable={tableName}
        currentAction={action}
        currentWorker={worker}
        actorFilterValues={actorFilterValues}
        roster={roster}
      />
    </AppShell>
  );
}
