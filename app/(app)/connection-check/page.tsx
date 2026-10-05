import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import ConnectionCheckClient from "@/app/(app)/connection-check/ConnectionCheckClient";

// TEMPORARY (2026-10-05): what this phone's network and filter let the app do
// — see ConnectionCheckClient. Open to every signed-in role: the phones that
// matter most here may well be workers'.
export default async function ConnectionCheckPage() {
  const { profile } = await requireProfile();
  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <ConnectionCheckClient userName={profile.full_name ?? profile.email ?? ""} />
    </AppShell>
  );
}
