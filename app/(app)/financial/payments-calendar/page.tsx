import { Suspense } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { Card, CardContent } from "@/components/ui/card";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { ensureRecurringExpensesForDate } from "@/lib/recurring-expenses";
import { runAfterResponse } from "@/lib/after-response";
import { loadPaymentsCalendarView } from "@/lib/financial/paymentsCalendarPage";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_SHADOW } from "@/lib/powersync/config";
import PaymentsHubClient from "./PaymentsHubClient";
import LocalPaymentsCalendarPage from "./LocalPaymentsCalendarPage";
import PaymentsCalendarServerCheck from "./PaymentsCalendarServerCheck";

export const revalidate = 0;

// "צפי תזרים" — scheduled money, in both directions (the neighbour of תזרים,
// which is what already happened). The route keeps its old path so existing
// links, alerts and bookmarks keep working. Two tabs:
//   • לוח תזרים — the calendar of every expected payment: unpaid/scheduled
//     expenses, recurring bills, loan repayments, worker wages, card charges
//     going out; receivables, rent and promises coming in. Add a payment to a
//     day, mark it paid or collected, split it.
//   • קבועות — the recurring rules (moved out of Settings).
// What it reads is lib/financial/paymentsCalendarPage.ts — the same on the
// server, on a device's copy, and in the daily check between the two.
export default async function PaymentsCalendarPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") redirect("/dashboard");

  // The month's recurring bills are made by the nightly job
  // (api/cron/recurring-expenses); opening the page with a connection makes any
  // still missing — after the response, so they never hold the page up (they
  // reach the board a moment later). It used to be waited for on every opening.
  runAfterResponse("payments calendar recurring bills", async () => {
    const ensure = await ensureRecurringExpensesForDate(supabase);
    if (!ensure.ok && !ensure.skippedMissingSchema) throw new Error(ensure.error ?? "recurring bills were not made");
  });

  // The device version: the page worked out from this person's on-device copy
  // (LocalPaymentsCalendarPage) — only where the copy has the calendar's
  // tables (sync rules v1.15). ?data=server is the way back when it can't.
  const wantsServer = [((await searchParams) ?? {}).data].flat()[0] === "server";
  if (!wantsServer && (await devicePageOn("paymentsCalendar", profile))) {
    // Once a day per device, the server's own page too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.paymentsCalendar && (await deviceCheckDue("paymentsCalendar"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <DeviceFrameMark page="paymentsCalendar" renderedAt={serverRenderedAt()} />
        <div className="space-y-5">
          <LocalPaymentsCalendarPage viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }} />
        </div>
        {checkDue ? (
          <Suspense fallback={null}>
            <PaymentsCalendarServerCheck supabase={supabase} userId={profile.id} role={profile.role ?? ""} locale={profile.locale} />
          </Suspense>
        ) : null}
      </AppShell>
    );
  }

  const view = await loadPaymentsCalendarView(supabase);
  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-5">
        {view.error ? (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{view.error}</CardContent>
          </Card>
        ) : (
          <PaymentsHubClient
            items={view.items}
            todayIso={view.todayIso}
            templates={view.templates}
            projects={view.projects}
            properties={view.properties}
            orders={view.orders}
            accounts={view.accounts}
            incomeOptions={view.incomeOptions}
            expenseMissingSchema={view.expenseMissingSchema}
          />
        )}
      </div>
    </AppShell>
  );
}
