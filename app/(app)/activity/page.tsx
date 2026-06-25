import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_TABLE_OPTIONS,
  getAuditFeedPaginated,
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

  const result = await getAuditFeedPaginated(supabase, {
    page,
    tableName: tableName || null,
    action: action || null,
  });

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <ActivityClient
        key={`${tableName}|${action}|${result.page}`}
        items={result.items}
        totalCount={result.totalCount}
        page={result.page}
        totalPages={result.totalPages}
        error={result.error}
        tableOptions={[...AUDIT_TABLE_OPTIONS]}
        actionOptions={[...AUDIT_ACTION_OPTIONS]}
        currentTable={tableName}
        currentAction={action}
      />
    </AppShell>
  );
}
