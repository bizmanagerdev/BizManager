import AppShell from "@/components/layout/AppShell";
import { requireAdminPage } from "@/lib/auth/roleAccess";
import ConnectionCheckClient from "@/app/(app)/connection-check/ConnectionCheckClient";

// TEMPORARY (2026-10-05), admins only: what this phone's network and filter let
// the app do — see ConnectionCheckClient.
export default async function ConnectionCheckPage() {
  const { profile } = await requireAdminPage();
  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <ConnectionCheckClient
        userName={profile.full_name ?? profile.email ?? ""}
        locale={profile.locale === "ar" ? "ar" : "he"}
        isAdmin={profile.role === "admin"}
      />
    </AppShell>
  );
}
