import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { requireProfile } from "@/lib/auth/requireProfile";
import { Card, CardContent } from "@/components/ui/card";
import DashboardGreeting from "@/components/dashboard/DashboardGreeting";
import QuickActionsClient from "@/app/dashboard/QuickActionsClient";
import { loadQuickActionsData } from "@/app/dashboard/quick-actions-data";
import {
  WeekOverviewSection,
  WeekOverviewFallback,
  DashboardPanels,
  PanelsFallback,
} from "@/app/dashboard/DashboardSections";

export const revalidate = 60;

export default async function DashboardPage() {
  // Only the (fast, indexed) auth/profile check is awaited up front. The greeting
  // and — critically — the quick-action BUTTONS render immediately after it, so
  // they're present and clickable at first paint. The dropdown data they need is
  // kicked off here but NOT awaited: it streams into the dialogs a moment later
  // (filling them in place, no remount), and the panels below stream on their own.
  const { profile, supabase } = await requireProfile();

  const dataPromise = loadQuickActionsData(supabase, profile);

  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? "";
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "בוקר טוב" : currentHour < 18 ? "צהריים טובים" : "ערב טוב";

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        <section className="text-right">
          <DashboardGreeting name={firstName} initialGreeting={greeting} />
        </section>

        {/* Quick actions — instant. Buttons render now; dialog data streams in. */}
        <Card>
          <CardContent className="pt-6">
            <QuickActionsClient
              dataPromise={dataPromise}
              currentUserId={profile.id}
              currentUserRole={profile.role}
            />
          </CardContent>
        </Card>

        <Suspense fallback={<WeekOverviewFallback />}>
          <WeekOverviewSection />
        </Suspense>

        <Suspense fallback={<PanelsFallback />}>
          <DashboardPanels />
        </Suspense>
      </PageStack>
    </AppShell>
  );
}
