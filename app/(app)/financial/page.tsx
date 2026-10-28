import { Suspense } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import CashFlowPageContent from "@/app/(app)/financial/CashFlowPageContent";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_SHADOW } from "@/lib/powersync/config";
import { cashFlowViewFilters } from "@/lib/financial/cashFlowPage";
import { ensureRecurringExpensesForDate } from "@/lib/recurring-expenses";
import { runAfterResponse } from "@/lib/after-response";
import LocalCashFlowPage from "./LocalCashFlowPage";
import CashFlowServerCheck from "./CashFlowServerCheck";

export const revalidate = 60;

export default async function FinancialPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const resolvedSearchParams = (await searchParams) ?? {};

  // The device version: the page worked out from this person's on-device copy
  // (LocalCashFlowPage) — only where the copy has the money tables.
  // ?data=server is the way back when the copy can't serve it.
  const wantsServer = [resolvedSearchParams.data].flat()[0] === "server";
  if (!wantsServer && (await devicePageOn("cashFlow", profile))) {
    // The day's recurring bills are still made when the page is opened with a
    // connection, as the server's page does before it reads — after the
    // response here, so they never hold the page up (they reach the copy a
    // moment later). The daily job makes them too (api/cron/recurring-expenses).
    runAfterResponse("financial recurring bills", () => ensureRecurringExpensesForDate(supabase));
    // Once a day per device, the server's own page too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.cashFlow && (await deviceCheckDue("cashFlow"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <DeviceFrameMark page="cashFlow" renderedAt={serverRenderedAt()} />
        <LocalCashFlowPage viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }} />
        {checkDue ? (
          <Suspense fallback={null}>
            <CashFlowServerCheck
              supabase={supabase}
              filters={cashFlowViewFilters(resolvedSearchParams)}
              userId={profile.id}
              role={profile.role ?? ""}
              locale={profile.locale}
            />
          </Suspense>
        ) : null}
      </AppShell>
    );
  }

  return (
    <CashFlowPageContent
      profile={profile}
      supabase={supabase}
      searchParams={resolvedSearchParams}
    />
  );
}
