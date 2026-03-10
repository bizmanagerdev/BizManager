import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";

export default async function FinancialPage() {
  const { profile } = await requireProfile();

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">פיננסי</h1>
        <p className="text-sm text-muted-foreground">
          מסך פיננסי מרכזי. אפשר להמשיך מכאן לדוחות, הכנסות, הוצאות ותזרים.
        </p>
      </div>
    </AppShell>
  );
}

