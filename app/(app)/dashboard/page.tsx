import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { requireProfile } from "@/lib/auth/requireProfile";
import { Card, CardContent } from "@/components/ui/card";
import DashboardGreeting from "@/components/dashboard/DashboardGreeting";
import DashboardCustomizer from "@/components/dashboard/DashboardCustomizer";
import QuickActionsClient from "@/app/(app)/dashboard/QuickActionsClient";
import { loadQuickActionsData } from "@/app/(app)/dashboard/quick-actions-data";
import { sanitizePrefs } from "@/lib/dashboard/widgets";
import { DashboardPanels, PanelsFallback } from "@/app/(app)/dashboard/DashboardSections";
import WorkerShiftPanel from "@/app/(app)/dashboard/WorkerShiftPanel";

export const revalidate = 60;

export default async function DashboardPage() {
  // Only the (fast, indexed) auth/profile check is awaited up front. The greeting
  // and — critically — the quick-action BUTTONS render immediately after it, so
  // they're present and clickable at first paint. The dropdown data they need is
  // kicked off here but NOT awaited: it streams into the dialogs a moment later
  // (filling them in place, no remount), and the panels below stream on their own.
  const { profile, supabase } = await requireProfile();

  // A worker has no quick-action tiles: the two that were left (the delivery run
  // and a new task) are already a tap away in the nav and behind the +. Skipping
  // the card also skips its picker data — customers, products, projects, orders
  // — which he can't use and mostly can't read anyway.
  const isWorker = profile.role === "worker";
  const dataPromise = isWorker ? null : loadQuickActionsData(supabase, profile);
  // Prefs ride along on the profile (requireProfile's single `users` query), so
  // the shell no longer waits on a second round-trip just to hydrate the customizer.
  const dashboardPrefs = sanitizePrefs(profile.dashboard_prefs);

  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? "";
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "בוקר טוב" : currentHour < 18 ? "צהריים טובים" : "ערב טוב";
  const now = new Date();
  const greetingDate = `${new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(now)} · ${new Intl.DateTimeFormat(
    "he-IL",
    { day: "numeric", month: "long", year: "numeric" }
  ).format(now)}`;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        <section className="flex items-start justify-between gap-3">
          {/* min-w-0 lets this flex item shrink below its content so a long
              (unbreakable) name wraps instead of pushing the row — and the whole
              page — wider than a phone screen. */}
          <div className="min-w-0 flex-1 text-right">
            <DashboardGreeting name={firstName} initialGreeting={greeting} initialDate={greetingDate} />
          </div>
          {/* Nothing worth rearranging on a worker's board — it's the clock, his
              tasks and his deliveries — so the customizer would be a control
              over three fixed cards. */}
          {isWorker ? null : (
            <div className="shrink-0">
              <DashboardCustomizer role={profile.role} initialPrefs={dashboardPrefs} />
            </div>
          )}
        </section>

        {/* A worker's day starts by clocking in, so the clock sits above
            everything else on his dashboard. Staff clock people in from the
            payroll queue instead, so they don't get this. */}
        {isWorker ? (
          <Suspense fallback={null}>
            <WorkerShiftPanel userId={profile.id} />
          </Suspense>
        ) : null}

        {/* Quick actions — instant. Buttons render now; dialog data streams in. */}
        {dataPromise ? (
          <Card>
            <CardContent className="pt-6">
              <QuickActionsClient
                dataPromise={dataPromise}
                currentUserId={profile.id}
                currentUserRole={profile.role}
              />
            </CardContent>
          </Card>
        ) : null}

        <Suspense fallback={<PanelsFallback />}>
          <DashboardPanels />
        </Suspense>
      </PageStack>
    </AppShell>
  );
}
