import { redirect } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { requireProfile } from "@/lib/auth/requireProfile";
import { firstAccessiblePrefix, hasSectionAccess, isStaffRole } from "@/lib/auth/roleAccess";
import DashboardGreetingTitle from "@/components/dashboard/DashboardGreetingTitle";
import { firstNameOf, greetingForHour, viewerHour } from "@/lib/dashboard/greeting";
import { DashboardPanels, PanelsFallback } from "@/app/(app)/dashboard/DashboardSections";
import { DashboardPictureKeeper } from "@/components/dashboard/DashboardPicture";

export const revalidate = 60;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  // Only the (fast, indexed) auth/profile check is awaited up front; the panels
  // below stream on their own.
  //
  // There is no quick-action grid here any more — every create flow lives behind
  // the + (top bar on desktop, the raised FAB in the bottom nav on a phone), so
  // it's the same menu on every screen instead of one set on the dashboard and a
  // shorter one everywhere else. That also drops this page's heaviest fetch: the
  // picker data (customers / products / projects / orders / workers) is now
  // loaded on demand by the menu itself, once, when it's first opened.
  const [{ profile }, { data: dataSource }] = await Promise.all([requireProfile(), searchParams]);

  // A worker without the dashboard section would otherwise land here right
  // after login (middleware's post-login redirect is unconditionally
  // "/dashboard" — fixing that there would mean fetching section_access on
  // every request, the exact per-request DB round-trip cost middleware.ts's
  // own getSession-not-getUser tradeoff already fought hard to avoid). Send
  // him to his first enabled section instead of bouncing through /no-access
  // on a route he was never trying to reach.
  if (!isStaffRole(profile.role) && !hasSectionAccess(profile.role, profile.section_access, "dashboard")) {
    redirect(firstAccessiblePrefix(profile.section_access) ?? "/no-access");
  }

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
        // The server runs UTC, so the SSR snapshot reads Israel's clock; the
        // component re-reads the viewer's own device after hydration.
        initialGreeting={greetingForHour(viewerHour(), profile.locale)}
        locale={profile.locale}
      />
      {/* No heading here: the greeting and today's date are the "היום" card's
          header now (they were the top bar's title/subtitle before), and
          «התאמת לוח» lives in /profile — the board starts with the cards.
          The negative margin claws back roughly half of AppShell's shared
          top padding (py-4/md:p-6/lg:p-8): that padding earns its keep on a
          page with its own heading below the bar, but with none here it was
          just dead air above the board (user, 2026-08-19: "start the content
          a little higher... theres no real top bar now"). DASHBOARD_BOARD_CLASS's
          own height calc is trimmed by the same lg amount, so the board grows
          into the reclaimed space instead of leaving it empty at the bottom. */}
      {/* The dashboard as it last stood on this device is on screen the
          instant the app opens (DashboardPictureFrame, in the app's frame);
          this hands over to the live screen as soon as it looks the same, and
          keeps it for next time. */}
      <DashboardPictureKeeper userId={profile.id} locale={profile.locale} />
      <PageStack data-dashboard-board className="-mt-2 md:-mt-3 lg:-mt-4">
        <Suspense fallback={<PanelsFallback />}>
          {/* ?data=server: the device-copy cards' fallback to the server version. */}
          <DashboardPanels forceServer={dataSource === "server"} />
        </Suspense>
      </PageStack>
    </AppShell>
  );
}
