import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { loadAccountsOverview } from "@/lib/accounts";
import BankClient from "./BankClient";

export const dynamic = "force-dynamic";

export default async function BankPage() {
  const { profile, supabase } = await requireProfile();
  // חשבונות (balances/management) is admin-only. Office still assigns an account
  // when recording payments via the AccountSelect picker (read-only GET), just not here.
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const accounts = await loadAccountsOverview(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <BankClient accounts={accounts} />
    </AppShell>
  );
}
