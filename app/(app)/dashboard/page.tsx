import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { requireProfile } from "@/lib/auth/requireProfile";
import DashboardGreetingTitle from "@/components/dashboard/DashboardGreetingTitle";
import { firstNameOf, greetingForHour } from "@/lib/dashboard/greeting";
import { DashboardPanels, PanelsFallback } from "@/app/(app)/dashboard/DashboardSections";

export const revalidate = 60;

export default async function DashboardPage() {
  // Only the (fast, indexed) auth/profile check is awaited up front; the panels
  // below stream on their own.
  //
  // There is no quick-action grid here any more — every create flow lives behind
  // the + (top bar on desktop, the raised FAB in the bottom nav on a phone), so
  // it's the same menu on every screen instead of one set on the dashboard and a
  // shorter one everywhere else. That also drops this page's heaviest fetch: the
  // picker data (customers / products / projects / orders / workers) is now
  // loaded on demand by the menu itself, once, when it's first opened.
  const { profile } = await requireProfile();

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* The board's backdrop, and ONLY the board's: a light hue behind white
          cards is what gives this page its depth, and it has no business on any
          other screen (or in the top bar's white brand corner). */}
      <div aria-hidden className="board-backdrop" />

      {/* Renders nothing — it puts "ערב טוב, סורוצקין 👋" in the top bar, where
          every other page shows its name. A greeting greets the person; the day's
          card is named by the date. */}
      <DashboardGreetingTitle
        name={firstNameOf(profile.full_name)}
        initialGreeting={greetingForHour(new Date().getHours())}
      />
      <PageStack>
        {/* No heading here: the greeting and today's date are the "היום" card's
            header now (they were the top bar's title/subtitle before), and
            «התאמת לוח» lives in /profile — the board starts with the cards. */}

        <Suspense fallback={<PanelsFallback />}>
          <DashboardPanels />
        </Suspense>
      </PageStack>
    </AppShell>
  );
}
