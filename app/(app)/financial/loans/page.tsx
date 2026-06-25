import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { fetchLoans, summarizeLoans } from "@/lib/loans";
import LoansClient from "./LoansClient";

export const revalidate = 30;

export default async function LoansPage() {
  const { profile, supabase } = await requireProfile();

  // Loans are sensitive financial data — admin only (matches the nav gating).
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const loans = await fetchLoans(supabase);
  const summary = summarizeLoans(loans);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <LoansClient loans={loans} summary={summary} />
    </AppShell>
  );
}
