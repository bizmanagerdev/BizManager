import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";

export default async function DashboardPage() {
  const { profile } = await requireProfile();

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <h1>דשבורד</h1>
      <p>מחובר/ת כ: {profile.email}</p>
      <p>תפקיד: {profile.role}</p>
    </AppShell>
  );
}
