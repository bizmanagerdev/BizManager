import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/requireProfile";
import CashFlowPageContent from "@/app/financial/CashFlowPageContent";

export const revalidate = 60;

export default async function FinancialReportsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <CashFlowPageContent
      profile={profile}
      supabase={supabase}
      searchParams={resolvedSearchParams}
      view="reports"
    />
  );
}
