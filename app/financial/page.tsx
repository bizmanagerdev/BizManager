import { requireProfile } from "@/lib/auth/requireProfile";
import CashFlowPageContent from "@/app/financial/CashFlowPageContent";

export const revalidate = 60;

export default async function FinancialPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile, supabase } = await requireProfile();
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <CashFlowPageContent
      profile={profile}
      supabase={supabase}
      searchParams={resolvedSearchParams}
      basePath="/financial"
    />
  );
}
