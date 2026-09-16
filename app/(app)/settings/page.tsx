import { redirect } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import SettingsTabs from "@/app/(app)/settings/SettingsTabs";
import { loadMorningSettings, type MorningSettings } from "@/lib/morning/settings";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { getCurrentCcFeeRate } from "@/lib/settings/ccFee";
import { getBooksStartDate } from "@/lib/settings/booksStartDate";
import { loadAccounts, type Account } from "@/lib/accounts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { describeDevice } from "@/lib/notifications/devices";
import type { ConnectedDevice } from "@/components/notifications/ConnectedDevicesCard";

type Row = Record<string, unknown>;

function getString(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  return typeof v === "string" ? v : null;
}

// Read via the service-role client so we see every user's subscriptions — RLS
// on push_subscriptions would otherwise hide everyone but the admin. Kept as
// its own async function (instead of inline) so its internal fallback +
// name-lookup chain can still join the page's main Promise.all as ONE promise.
async function loadConnectedDevices(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<{ connectedDevices: ConnectedDevice[]; devicesUnavailable: boolean }> {
  if (!admin) {
    return { connectedDevices: [], devicesUnavailable: true };
  }
  // Prefer the full row (device metadata), but fall back to base columns so
  // the list still works before the user_agent/last_seen_at migration runs.
  let subs: Row[] | null = (
    await admin
      .from("push_subscriptions")
      .select("user_id,endpoint,user_agent,created_at,last_seen_at")
      .order("created_at", { ascending: false })
  ).data as Row[] | null;
  if (!subs) {
    subs = (
      await admin.from("push_subscriptions").select("user_id,endpoint,created_at").order("created_at", { ascending: false })
    ).data as Row[] | null;
  }
  const subRows = (subs ?? []) as Row[];

  const ids = [...new Set(subRows.map((r) => getString(r, "user_id")).filter(Boolean))] as string[];
  const nameMap = new Map<string, string>();
  if (ids.length) {
    const { data: us } = await admin.from("users").select("id,full_name,email").in("id", ids);
    for (const u of (us ?? []) as Row[]) {
      const id = getString(u, "id");
      if (id) nameMap.set(id, (getString(u, "full_name") ?? getString(u, "email") ?? "משתמש").trim());
    }
  }

  const connectedDevices = subRows.map((r) => {
    const info = describeDevice(getString(r, "endpoint") ?? "", getString(r, "user_agent"));
    return {
      userId: getString(r, "user_id") ?? "",
      userLabel: nameMap.get(getString(r, "user_id") ?? "") ?? "משתמש לא ידוע",
      os: info.os,
      browser: info.browser,
      icon: info.icon,
      connectedAt: getString(r, "created_at"),
      lastSeenAt: getString(r, "last_seen_at"),
    };
  });
  return { connectedDevices, devicesUnavailable: false };
}

export default async function SettingsPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const isAdmin = true;
  const admin = createSupabaseAdminClient();

  // Eight independent reads (the shared user list + seven admin-only lookups)
  // run as ONE round trip instead of sequentially.
  const [usersResult, morningSettings, vatRate, ccFeeRate, booksStartDate, accounts, auditCfgResult, devices] = await Promise.all([
    // Only users who can actually log in and use the system are valid alert
    // recipients — match the access rule used in requireProfile / requireRouteAccess
    // (active AND system_access AND role != worker_no_access).
    supabase
      .from("users")
      .select("id,full_name,email")
      .eq("active", true)
      .eq("system_access", true)
      .neq("role", "worker_no_access")
      .order("full_name", { ascending: true })
      .range(0, 499),
    isAdmin ? loadMorningSettings(supabase) : Promise.resolve(null as MorningSettings | null),
    isAdmin ? getCurrentVatRate(supabase) : Promise.resolve(0.18),
    isAdmin ? getCurrentCcFeeRate(supabase) : Promise.resolve(0.14),
    isAdmin ? getBooksStartDate(supabase) : Promise.resolve(null),
    isAdmin ? loadAccounts(supabase) : Promise.resolve([] as Account[]),
    isAdmin
      ? supabase.from("business_settings").select("audit_logging_enabled").eq("id", true).maybeSingle()
      : Promise.resolve({ data: null as { audit_logging_enabled?: boolean } | null }),
    isAdmin
      ? loadConnectedDevices(admin)
      : Promise.resolve({ connectedDevices: [] as ConnectedDevice[], devicesUnavailable: false }),
  ]);

  const users = ((usersResult.data ?? []) as Row[])
    .map((r) => ({ id: getString(r, "id") ?? "", label: (getString(r, "full_name") ?? getString(r, "email") ?? "").trim() }))
    .filter((u) => u.id && u.label);

  const auditLoggingEnabled =
    (auditCfgResult.data as { audit_logging_enabled?: boolean } | null)?.audit_logging_enabled ?? true;

  const { connectedDevices, devicesUnavailable } = devices;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* SettingsTabs reads ?tab= via useSearchParams (to deep-link e.g.
          ?tab=finance) — Next requires a Suspense boundary around that. */}
      <Suspense fallback={null}>
        <SettingsTabs
          isAdmin={isAdmin}
          users={users}
          connectedDevices={connectedDevices}
          devicesUnavailable={devicesUnavailable}
          morningSettings={morningSettings}
          vatRate={vatRate}
          ccFeeRate={ccFeeRate}
          booksStartDate={booksStartDate}
          todayIso={new Date().toISOString().slice(0, 10)}
          auditLoggingEnabled={auditLoggingEnabled}
          accounts={accounts}
        />
      </Suspense>
    </AppShell>
  );
}
