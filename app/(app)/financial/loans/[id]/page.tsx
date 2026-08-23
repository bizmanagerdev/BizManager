import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { fetchLoans } from "@/lib/loans";
import LoanDetailClient from "./LoanDetailClient";

export const revalidate = 30;

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();

  // Loans are sensitive financial data — admin only (matches the list page and the nav gating).
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const loans = await fetchLoans(supabase);
  const loan = loans.find((l) => l.id === id) ?? null;
  if (!loan) {
    notFound();
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <LoanDetailClient loan={loan} />
    </AppShell>
  );
}
