import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";

export default async function ProjectsPage() {
  const { profile } = await requireProfile();

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <h1>Projects</h1>
      <p>Coming soon.</p>
    </AppShell>
  );
}
