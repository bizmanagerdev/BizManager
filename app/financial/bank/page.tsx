import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { loadBankTransfers } from "@/lib/financial/bankTransfers";
import BankClient from "./BankClient";

export const dynamic = "force-dynamic";

export default async function BankPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const report = await loadBankTransfers(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <BankClient report={report} />
    </AppShell>
  );
}
