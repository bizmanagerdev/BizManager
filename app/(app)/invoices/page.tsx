import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";

export default async function InvoicesPage() {
  const { profile } = await requireStaffPage();

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <h1>חשבוניות</h1>
      <p>בקרוב.</p>
    </AppShell>
  );
}
