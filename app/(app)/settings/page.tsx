import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import SettingsTabs from "@/app/(app)/settings/SettingsTabs";
import { loadMorningSettings, type MorningSettings } from "@/lib/morning/settings";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { loadAccounts, type Account } from "@/lib/accounts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { describeDevice } from "@/lib/notifications/devices";
import type { ConnectedDevice } from "@/components/notifications/ConnectedDevicesCard";

type Row = Record<string, unknown>;

function getString(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  return typeof v === "string" ? v : null;
}

export default async function SettingsPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const isAdmin = true;

  // ── Shared lookups ──────────────────────────────────────────────────────
  // Only users who can actually log in and use the system are valid alert
  // recipients — match the access rule used in requireProfile / requireRouteAccess
  // (active AND system_access AND role != worker_no_access).
  const usersResult = await supabase.from("users").select("id,full_name,email").eq("active", true)
    .eq("system_access", true).neq("role", "worker_no_access")
    .order("full_name", { ascending: true }).range(0, 499);

  const users = ((usersResult.data ?? []) as Row[])
    .map((r) => ({ id: getString(r, "id") ?? "", label: (getString(r, "full_name") ?? getString(r, "email") ?? "").trim() }))
    .filter((u) => u.id && u.label);

  // ── Morning integration (admin only) ────────────────────────────────────
  let morningSettings: MorningSettings | null = null;
  if (isAdmin) {
    morningSettings = await loadMorningSettings(supabase);
  }

  // ── VAT rate (admin only) ────────────────────────────────────────────────
  const vatRate = isAdmin ? await getCurrentVatRate(supabase) : 0.18;

  // ── Accounts (admin only) — empty list if the table isn't deployed yet ────
  const accounts: Account[] = isAdmin ? await loadAccounts(supabase) : [];

  // ── Audit-logging switch (admin only) ────────────────────────────────────
  let auditLoggingEnabled = true;
  if (isAdmin) {
    const { data: auditCfg } = await supabase
      .from("business_settings")
      .select("audit_logging_enabled")
      .eq("id", true)
      .maybeSingle();
    auditLoggingEnabled =
      (auditCfg as { audit_logging_enabled?: boolean } | null)?.audit_logging_enabled ?? true;
  }

  // ── Connected push devices (admin only) ─────────────────────────────────
  // Read via the service-role client so we see every user's subscriptions —
  // RLS on push_subscriptions would otherwise hide everyone but the admin.
  let connectedDevices: ConnectedDevice[] = [];
  let devicesUnavailable = false;
  if (isAdmin) {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      devicesUnavailable = true;
    } else {
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
          await admin
            .from("push_subscriptions")
            .select("user_id,endpoint,created_at")
            .order("created_at", { ascending: false })
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

      connectedDevices = subRows.map((r) => {
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
    }
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <SettingsTabs
        isAdmin={isAdmin}
        users={users}
        connectedDevices={connectedDevices}
        devicesUnavailable={devicesUnavailable}
        morningSettings={morningSettings}
        vatRate={vatRate}
        auditLoggingEnabled={auditLoggingEnabled}
        accounts={accounts}
      />
    </AppShell>
  );
}
